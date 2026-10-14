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
  if (!Number.isSafeInteger(amountFen) || !Number.isSafeInteger(rateBps) || amountFen < 0 || rateBps < 0) {
    throw new Error("金额和比例必须是非负安全整数");
  }
  const result = (BigInt(amountFen) * BigInt(rateBps)) / 10_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("计算结果超出安全整数范围");
  return Number(result);
}
