import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class names, last-wins on conflicting utilities.
 *
 *  Kept out of `utils.ts` deliberately: that module is imported by the server for
 *  its date and phone helpers, and the server has no business pulling in a
 *  Tailwind class merger. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
