import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function createSecretBox(encodedKey: string) {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) throw new Error("Invalid LOOMIC_SECRET_KEY");
  return {
    sealSecret(plain: string, aad = "loomic:xy2api:v1"): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(aad));
      const encrypted = Buffer.concat([
        cipher.update(plain, "utf8"),
        cipher.final(),
      ]);
      return [
        "v1",
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        encrypted.toString("base64url"),
      ].join(".");
    },
    openSecret(sealed: string, aad = "loomic:xy2api:v1"): string {
      try {
        const parts = sealed.split(".");
        if (parts.length !== 4 || parts[0] !== "v1") throw new Error();
        const decode = (value: string) => {
          const bytes = Buffer.from(value, "base64url");
          if (bytes.toString("base64url") !== value) throw new Error();
          return bytes;
        };
        const iv = decode(parts[1] ?? "");
        const tag = decode(parts[2] ?? "");
        if (iv.length !== 12 || tag.length !== 16) throw new Error();
        const cipher = createDecipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(Buffer.from(aad));
        cipher.setAuthTag(tag);
        return Buffer.concat([
          cipher.update(decode(parts[3] ?? "")),
          cipher.final(),
        ]).toString("utf8");
      } catch {
        throw new Error("Unable to decrypt xy2api credential");
      }
    },
  };
}

export type SecretBox = ReturnType<typeof createSecretBox>;
export const sealSecret = (plain: string) =>
  createSecretBox(process.env.LOOMIC_SECRET_KEY ?? "").sealSecret(plain);
export const openSecret = (sealed: string) =>
  createSecretBox(process.env.LOOMIC_SECRET_KEY ?? "").openSecret(sealed);
