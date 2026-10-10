export function getRssPollIntervalMs(): number {
  const value = process.env.RSS_POLL_INTERVAL_SECONDS?.trim() ?? "60";
  const seconds = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(seconds) ||
    seconds < 30 ||
    seconds * 1000 > 2_147_483_647
  ) {
    throw new Error(
      "RSS_POLL_INTERVAL_SECONDS must be an integer of at least 30 within the supported timer range.",
    );
  }
  return seconds * 1000;
}
