const consoleLog = console.log.bind(console);

console.log = (...args: unknown[]) => {
  const first = args[0];
  if (
    args.length === 1 &&
    typeof first === "object" &&
    first !== null &&
    "severity_local" in first &&
    (first as { severity_local?: unknown }).severity_local === "NOTICE"
  ) {
    return;
  }
  consoleLog(...args);
};
