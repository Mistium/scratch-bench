import type {
  Command,
  SetupInfo,
  Variant,
  VariantInfo,
} from "./runtimes/types.ts";

export const COMPILER_VARIANTS: Variant[] = [
  {
    id: "compiler",
    name: "compiler",
    default: true,
    env: { BENCH_COMPILER: "1" },
  },
  {
    id: "interpreter",
    name: "interpreter",
    default: false,
    env: { BENCH_COMPILER: "0" },
  },
];

export const infoOf = (v: Variant): VariantInfo => ({
  id: v.id,
  name: v.name,
  default: v.default,
});

export const variantsToRun = (
  variants: Variant[] | undefined,
  all: boolean,
): (Variant | null)[] => {
  if (!variants?.length) return [null];
  return all ? variants : variants.filter((v) => v.default);
};

export const setupVariants = (
  setup: SetupInfo | Error | undefined,
): Variant[] | undefined =>
  setup instanceof Error ? undefined : setup?.variants;

export const resultFileName = (
  suite: string,
  runtime: string,
  variant: VariantInfo | null,
): string =>
  `${suite}-${runtime}${
    variant && !variant.default ? `@${variant.id}` : ""
  }.json`;

export const labelOf = (
  name: string,
  variant: VariantInfo | null | undefined,
): string => variant ? `${name} (${variant.name})` : name;

export const withVariant = (
  command: Command,
  variant: Variant | null | undefined,
): Command =>
  variant?.env
    ? {
      ...command,
      env: {
        ...(command.env ?? (process.env as Record<string, string>)),
        ...variant.env,
      },
    }
    : command;
