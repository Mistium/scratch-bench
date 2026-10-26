export const CATEGORY_IDS = [
  "loops",
  "variables",
  "math",
  "strings",
  "lists",
  "algorithms",
  "applications",
  "scheduler",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface Category {
  id: CategoryId;
  label: string;
  description: string;
  weight: number;
}

export const CATEGORIES: Record<CategoryId, Category> = {
  loops: {
    id: "loops",
    label: "Loops & control",
    description: "repeat, until, while, for each, nested loops and branching.",
    weight: 1,
  },
  variables: {
    id: "variables",
    label: "Variables",
    description: "Reading and writing global and sprite-local variables.",
    weight: 1,
  },
  math: {
    id: "math",
    label: "Math & comparison",
    description:
      "Arithmetic, rounding, trigonometry, number crunching and comparisons.",
    weight: 1,
  },
  strings: {
    id: "strings",
    label: "Strings",
    description: "Joining, indexing, searching and converting text.",
    weight: 1,
  },
  lists: {
    id: "lists",
    label: "Lists",
    description:
      "Appending, reading, replacing, inserting, deleting and searching lists.",
    weight: 1,
  },
  algorithms: {
    id: "algorithms",
    label: "Algorithms",
    description: "Sorting, sieving, matrix multiplication and recursion.",
    weight: 1.25,
  },
  applications: {
    id: "applications",
    label: "Applications",
    description:
      "Whole programs: game of life, an interpreter, a raycaster, a renderer and a parser.",
    weight: 1.5,
  },
  scheduler: {
    id: "scheduler",
    label: "Scheduler",
    description:
      "Threads, broadcasts, clones and yielding, timed end to end under the runtime's normal frame loop.",
    weight: 1.25,
  },
};

export interface Benchmark {
  id: string;
  category: CategoryId;
  label: string;
  description: string;
  unit: string;
  main?: boolean;
  weight?: number;
}

const b = (
  id: string,
  category: CategoryId,
  label: string,
  unit: string,
  description: string,
  extra: Partial<Benchmark> = {},
): Benchmark => ({ id, category, label, unit, description, ...extra });

export const BENCHMARKS: Benchmark[] = [
  b(
    "loops_empty",
    "loops",
    "Empty loop",
    "iterations",
    "A repeat loop with an empty body: pure loop overhead.",
  ),
  b(
    "loops_repeat",
    "loops",
    "Repeat",
    "iterations",
    "A repeat loop that changes a variable each iteration.",
  ),
  b(
    "loops_until",
    "loops",
    "Repeat until",
    "iterations",
    "A repeat-until loop counting up.",
  ),
  b("loops_while", "loops", "While", "iterations", "A while loop counting up."),
  b(
    "loops_foreach",
    "loops",
    "For each",
    "iterations",
    "A for-each loop summing its counter.",
  ),
  b(
    "loops_nested",
    "loops",
    "Nested loops",
    "iterations",
    "Two nested repeat loops.",
  ),
  b(
    "loops_ifelse",
    "loops",
    "If / else chain",
    "iterations",
    "A loop with a three-way if/else chain on the counter.",
  ),

  b(
    "vars_setchange",
    "variables",
    "Set and change",
    "iterations",
    "Setting and changing global variables in a loop.",
  ),
  b(
    "vars_many",
    "variables",
    "Many variables",
    "iterations",
    "Updating eight variables per iteration.",
  ),
  b(
    "vars_local",
    "variables",
    "Sprite-local variables",
    "iterations",
    "The same eight-variable update on sprite-local variables.",
  ),

  b(
    "math_arith",
    "math",
    "Arithmetic",
    "iterations",
    "Multiply, add, divide and modulo on numbers.",
  ),
  b("math_round", "math", "Rounding", "iterations", "floor, round and abs."),
  b("math_trig", "math", "Trigonometry", "iterations", "sin, cos and atan."),
  b(
    "math_expsqrt",
    "math",
    "Roots and exponents",
    "iterations",
    "sqrt, ln, e^ and 10^.",
  ),
  b(
    "math_nbody",
    "math",
    "Two-body simulation",
    "steps",
    "A gravity simulation with floats, square roots and divisions.",
  ),
  b(
    "math_mandel",
    "math",
    "Mandelbrot",
    "escape iterations",
    "Escape-time iterations for a small Mandelbrot grid.",
  ),
  b(
    "math_collatz",
    "math",
    "Collatz",
    "steps",
    "Collatz sequence lengths for the first hundred numbers.",
  ),
  b(
    "math_compare",
    "math",
    "Number comparisons",
    "iterations",
    "Chains of <, =, and, or, not on numbers.",
  ),
  b(
    "math_strcompare",
    "math",
    "String comparisons",
    "iterations",
    "Equality and ordering comparisons on strings.",
  ),

  b(
    "str_join",
    "strings",
    "Join",
    "joins",
    "Building a long string by repeated joins.",
  ),
  b(
    "str_letter",
    "strings",
    "Letter of",
    "lookups",
    "Indexing into a long string.",
  ),
  b(
    "str_contains",
    "strings",
    "Contains and length",
    "iterations",
    "contains and length of on a long string.",
  ),
  b(
    "str_cast",
    "strings",
    "Number and text conversion",
    "conversions",
    "Converting numbers to text and back.",
  ),

  b(
    "list_append",
    "lists",
    "Append",
    "appends",
    "Appending to a list and clearing it.",
  ),
  b(
    "list_read",
    "lists",
    "Item of",
    "reads",
    "Random-access reads from a 100,000 item list.",
  ),
  b(
    "list_replace",
    "lists",
    "Replace item",
    "writes",
    "Random-access writes into a 100,000 item list.",
  ),
  b(
    "list_insdel",
    "lists",
    "Insert and delete",
    "operations",
    "Inserting and deleting in the middle of a list.",
  ),
  b(
    "list_search",
    "lists",
    "Search",
    "searches",
    "item # of and contains scanning a 1,000 item list.",
  ),

  b(
    "algo_sort",
    "algorithms",
    "Bubble sort",
    "comparisons",
    "Bubble sort of 100 pseudo-random numbers.",
    { main: true },
  ),
  b(
    "algo_sieve",
    "algorithms",
    "Sieve of Eratosthenes",
    "steps",
    "Sieving the primes below 5,000.",
  ),
  b(
    "algo_matmul",
    "algorithms",
    "Matrix multiply",
    "multiply-adds",
    "A 16x16 matrix multiplication on flat lists.",
  ),
  b(
    "algo_fib",
    "algorithms",
    "Recursive Fibonacci",
    "calls",
    "Naive recursive fib(18) with custom blocks.",
  ),
  b(
    "algo_ack",
    "algorithms",
    "Ackermann",
    "calls",
    "The Ackermann function: deep recursion with custom blocks.",
  ),
  b(
    "algo_primes",
    "algorithms",
    "Trial division",
    "numbers tested",
    "Counting primes by trial division.",
  ),

  b(
    "app_life",
    "applications",
    "Game of life",
    "cell updates",
    "Conway's game of life on a 12x12 wrapping grid.",
    { main: true },
  ),
  b(
    "app_brainfuck",
    "applications",
    "Brainfuck interpreter",
    "steps",
    "An interpreter with a precomputed jump table running a triple-nested loop.",
    { main: true },
  ),
  b(
    "app_raycast",
    "applications",
    "Raycaster",
    "rays",
    "A DDA raycaster casting 320 rays into a map, without drawing.",
    { main: true },
  ),
  b(
    "app_projection",
    "applications",
    "Projection renderer",
    "frames",
    "A rotating cube projected to 2D and rasterized into a list with Bresenham lines.",
    { main: true },
  ),
  b(
    "app_ast",
    "applications",
    "Expression parser",
    "characters",
    "A recursive-descent parser building an AST in lists, then evaluating it.",
    { main: true },
  ),

  b(
    "sched_looptick",
    "scheduler",
    "Loop ticks",
    "ticks",
    "A single thread yielding once per loop iteration.",
  ),
  b(
    "sched_pingpong",
    "scheduler",
    "Broadcast and wait",
    "round trips",
    "Broadcast and wait with one receiver.",
  ),
  b(
    "sched_restart",
    "scheduler",
    "Script restarts",
    "restarts",
    "Re-broadcasting a message that restarts a running script.",
  ),
  b(
    "sched_clonechurn",
    "scheduler",
    "Clone churn",
    "clones",
    "Creating clones that delete themselves, in batches of 100.",
  ),
  b(
    "sched_threads",
    "scheduler",
    "Concurrent threads",
    "iterations",
    "101 scripts running yielding loops at the same time.",
    { main: true },
  ),
  b(
    "sched_fanout",
    "scheduler",
    "Broadcast fan-out",
    "script starts",
    "One broadcast starting 101 receiver scripts.",
    { main: true },
  ),
  b(
    "sched_fanwait",
    "scheduler",
    "Fan-out and wait",
    "script starts",
    "Broadcast and wait with 101 receivers.",
  ),
  b(
    "sched_waituntil",
    "scheduler",
    "Wait until polling",
    "ticks",
    "A yielding controller while 101 threads sit in wait until.",
  ),
];

export const BENCHMARK_BY_ID: Record<string, Benchmark> = Object.fromEntries(
  BENCHMARKS.map((x) => [x.id, x]),
);

export const benchmarksIn = (category: CategoryId): Benchmark[] =>
  BENCHMARKS.filter((x) => x.category === category);

export const MAIN_BENCHMARKS: Benchmark[] = BENCHMARKS.filter((x) => x.main);
