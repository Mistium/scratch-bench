export type ThemeChoice = "light" | "dark" | "system";

export const useTheme = () => {
  const choice = useCookie<ThemeChoice>("theme", {
    default: () => "system",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  const systemDark = useState("system-dark", () => false);

  const resolved = computed<"light" | "dark">(() =>
    choice.value === "system"
      ? (systemDark.value ? "dark" : "light")
      : choice.value
  );

  useHead({
    htmlAttrs: {
      "data-theme": computed(
        () => (choice.value === "system" ? undefined : choice.value),
      ),
    },
  });

  if (import.meta.client) {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    systemDark.value = query.matches;
    query.addEventListener("change", (e) => (systemDark.value = e.matches));
  }

  const cycle = () => {
    choice.value = choice.value === "system"
      ? "light"
      : choice.value === "light"
      ? "dark"
      : "system";
  };

  return { choice, resolved, cycle };
};
