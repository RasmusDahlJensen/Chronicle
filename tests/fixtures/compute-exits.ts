let warmed = false;

/** Test-only abrupt exit after startup, requiring actual worker replacement. */
export default function computeExits(): string {
  if (warmed) process.exit(17);
  warmed = true;
  return 'ready';
}
