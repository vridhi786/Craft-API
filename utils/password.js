import bcrypt from 'bcryptjs';

const COST = 12;
export const hashPassword = (plain) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

let dummy;
/** A real hash computed once, so unknown emails take as long to reject as wrong passwords (no user enumeration by timing). */
export async function burnPasswordCheck(plain) {
  dummy ||= await hashPassword('not-a-real-password');
  await bcrypt.compare(plain, dummy).catch(() => false);
}
