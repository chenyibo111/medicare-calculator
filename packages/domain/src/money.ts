export function yuanToFen(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("金额必须是最多两位小数的非负数字");
  }

  const [yuan, fraction = ""] = value.split(".");
  return Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
}

export function formatFen(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("金额必须是非负整数分");
  }

  return `¥${(value / 100).toFixed(2)}`;
}

export function multiplyByBps(amountFen: number, rateBps: number): number {
  return Math.floor((amountFen * rateBps) / 10_000);
}
