import { Prisma } from '@prisma/client';
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { PrismaService } from '../../prisma/prisma.service';

type BaileysRuntime = typeof import('@whiskeysockets/baileys');

const CREDS_KEY = 'creds';

/**
 * Baileys auth state stored in MySQL (table `whatsapp_auth`) instead of local files.
 *
 * Free hosts often have ephemeral disks; with file-based auth every redeploy would unlink the
 * WhatsApp device and require a new QR scan. Here the session lives in the database, so any
 * restart (or a new sender replica taking over) resumes the same linked device.
 *
 * Writes are serialized through a promise chain so a slow earlier write can never overwrite a
 * newer value for the same key.
 */
export async function usePrismaAuthState(
  prisma: PrismaService,
  sessionId: string,
  baileys: BaileysRuntime,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; clear: () => Promise<void> }> {
  const { BufferJSON, initAuthCreds, proto } = baileys;
  const serialize = (value: unknown) => JSON.stringify(value, BufferJSON.replacer);
  const deserialize = (raw: string) => JSON.parse(raw, BufferJSON.reviver);

  let writeChain: Promise<unknown> = Promise.resolve();
  const enqueueWrite = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeChain.then(fn, fn);
    writeChain = next.catch(() => undefined);
    return next;
  };

  const upsertMany = async (entries: [string, string][]) => {
    for (let i = 0; i < entries.length; i += 200) {
      const chunk = entries.slice(i, i + 200);
      const values = Prisma.join(chunk.map(([k, v]) => Prisma.sql`(${sessionId}, ${k}, ${v}, NOW(3))`));
      await prisma.$executeRaw`
        INSERT INTO whatsapp_auth (sessionId, \`key\`, value, updatedAt) VALUES ${values}
        ON DUPLICATE KEY UPDATE value = VALUES(value), updatedAt = VALUES(updatedAt)`;
    }
  };

  const credsRow = await prisma.whatsAppAuth.findUnique({ where: { sessionId_key: { sessionId, key: CREDS_KEY } } });
  const creds: AuthenticationCreds = credsRow ? deserialize(credsRow.value) : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        if (ids.length === 0) return result;
        const rows = await prisma.whatsAppAuth.findMany({
          where: { sessionId, key: { in: ids.map((id) => `${type}:${id}`) } },
          select: { key: true, value: true },
        });
        const prefix = `${type}:`.length;
        for (const row of rows) {
          let value = deserialize(row.value);
          if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
          result[row.key.slice(prefix)] = value;
        }
        return result;
      },
      set: async (data) =>
        enqueueWrite(async () => {
          const upserts: [string, string][] = [];
          const deletes: string[] = [];
          for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            for (const [id, value] of Object.entries(data[category] ?? {})) {
              const key = `${category}:${id}`;
              if (value) upserts.push([key, serialize(value)]);
              else deletes.push(key);
            }
          }
          if (upserts.length) await upsertMany(upserts);
          if (deletes.length) await prisma.whatsAppAuth.deleteMany({ where: { sessionId, key: { in: deletes } } });
        }),
    },
  };

  return {
    state,
    saveCreds: () => enqueueWrite(() => upsertMany([[CREDS_KEY, serialize(creds)]])),
    clear: () => enqueueWrite(() => prisma.whatsAppAuth.deleteMany({ where: { sessionId } }).then(() => undefined)),
  };
}
