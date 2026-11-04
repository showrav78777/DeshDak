import { z } from "zod";

const blockedPasswords = new Set(["password1234", "password12345", "123456789012", "qwertyuiop12", "letmein123456"]);

export const newPasswordSchema = z.string().min(12, "Use at least 12 characters.").max(128).superRefine((password, context) => {
  if (Buffer.byteLength(password, "utf8") > 72) context.addIssue({ code: "custom", message: "Password must be at most 72 UTF-8 bytes." });
  if (blockedPasswords.has(password.toLowerCase())) context.addIssue({ code: "custom", message: "Choose a less common password." });
});
