export type ErrorEntry = {
  description: string;
  hint?: string;
};

export const ERROR_CATALOG = {
  // populated in Task 2
} as const satisfies Record<string, ErrorEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;
