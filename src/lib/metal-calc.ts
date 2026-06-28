/**
 * Библиотека расчёта веса/длины металлопроката.
 *
 * Имена типов и материалов синхронизированы с фронтендом (app.js MC_PROFILE_FIELDS).
 */

export type Material = "steel" | "aluminum" | "stainless" | "copper" | "brass" | "bronze" | "zinc";

export const MATERIAL_DENSITY: Record<Material, number> = {
  steel: 7850,
  aluminum: 2700,
  stainless: 7900,
  copper: 8940,
  brass: 8500,
  bronze: 8800,
  zinc: 7140,
};

export const MATERIAL_LABELS: Record<Material, string> = {
  steel: "Сталь",
  aluminum: "Алюминий",
  stainless: "Нержавейка",
  copper: "Медь",
  brass: "Латунь",
  bronze: "Бронза",
  zinc: "Цинк",
};

export type ProfileType =
  | "round" | "pipe" | "square" | "rect" | "square_pipe" | "rect_pipe"
  | "angle" | "channel" | "ibeam" | "flat" | "sheet" | "hex" | "strip";

export const PROFILE_LABELS: Record<ProfileType, string> = {
  round: "Круг",
  pipe: "Труба круглая",
  square: "Квадрат",
  rect: "Полоса (прямоугольник)",
  square_pipe: "Труба квадратная",
  rect_pipe: "Труба прямоугольная",
  angle: "Уголок",
  channel: "Швеллер",
  ibeam: "Двутавр",
  flat: "Полоса",
  sheet: "Лист",
  hex: "Шестигранник",
  strip: "Лента",
};

export const PROFILE_FIELDS: Record<ProfileType, { key: string; label: string }[]> = {
  round: [{ key: "d", label: "Диаметр D, мм" }],
  pipe: [{ key: "d", label: "Диаметр D, мм" }, { key: "s", label: "Стенка S, мм" }],
  square: [{ key: "a", label: "Сторона A, мм" }],
  rect: [{ key: "a", label: "Сторона A, мм" }, { key: "b", label: "Сторона B, мм" }],
  square_pipe: [{ key: "a", label: "Сторона A, мм" }, { key: "s", label: "Стенка S, мм" }],
  rect_pipe: [{ key: "a", label: "A, мм" }, { key: "b", label: "B, мм" }, { key: "s", label: "S, мм" }],
  angle: [{ key: "a", label: "Полка A, мм" }, { key: "b", label: "Полка B, мм" }, { key: "s", label: "Толщина S, мм" }],
  channel: [{ key: "h", label: "Высота H, мм" }, { key: "b", label: "Полка B, мм" }, { key: "s", label: "Стенка S, мм" }],
  ibeam: [{ key: "h", label: "Высота H, мм" }, { key: "b", label: "Полка B, мм" }, { key: "s", label: "Стенка S, мм" }],
  flat: [{ key: "b", label: "Ширина B, мм" }, { key: "s", label: "Толщина S, мм" }],
  sheet: [{ key: "s", label: "Толщина S, мм" }, { key: "b", label: "Ширина B, мм" }],
  hex: [{ key: "d", label: "Диаметр впис. D, мм" }],
  strip: [{ key: "b", label: "Ширина B, мм" }, { key: "s", label: "Толщина S, мм" }],
};

export interface Dimensions {
  d?: number; a?: number; b?: number; s?: number; h?: number;
  [key: string]: number | undefined;
}

/** Площадь поперечного сечения, мм². */
export function crossSectionArea(type: ProfileType, dims: Dimensions): number {
  const { d, a, b, s, h } = dims;
  switch (type) {
    case "round":
      return (Math.PI * (d ?? 0) ** 2) / 4;
    case "pipe": {
      const D = d ?? 0, S = s ?? 0;
      const inner = D - 2 * S;
      return (Math.PI / 4) * (D * D - inner * inner);
    }
    case "square":
      return (a ?? 0) ** 2;
    case "rect":
    case "flat":
    case "strip":
      return (a ?? b ?? 0) * (b ?? s ?? 0);
    case "square_pipe": {
      const A = a ?? 0, S = s ?? 0;
      return A * A - (A - 2 * S) ** 2;
    }
    case "rect_pipe": {
      const A = a ?? 0, B = b ?? 0, S = s ?? 0;
      return A * B - (A - 2 * S) * (B - 2 * S);
    }
    case "angle": {
      const A = a ?? 0, B = b ?? 0, S = s ?? 0;
      return A * S + (B - S) * S;
    }
    case "channel":
    case "ibeam": {
      const H = h ?? 0, B = b ?? 0, S = s ?? 0;
      return 2 * B * S + (H - 2 * S) * S;
    }
    case "sheet":
      // Лист: площадь сечения = s × b (толщина × ширина)
      return (s ?? 0) * (b ?? 1000);
    case "hex":
      // Шестигранник (вписанная окружность d): (√3/2)·d²
      return (Math.sqrt(3) / 2) * (d ?? 0) ** 2;
    default:
      return 0;
  }
}

/** Вес 1 метра, кг/м. */
export function weightPerMeter(type: ProfileType, dims: Dimensions, material: Material): number {
  const area = crossSectionArea(type, dims);
  const density = MATERIAL_DENSITY[material];
  return area * 1e-6 * density;
}

/** Расчёт веса по длине. lengthM — длина в метрах на 1 шт, qty — количество. */
export function calcWeight(type: ProfileType, dims: Dimensions, material: Material, lengthM: number, qty: number): number {
  return weightPerMeter(type, dims, material) * lengthM * qty;
}

/** Расчёт длины по весу. Возвращает длину в метрах. */
export function calcLength(type: ProfileType, dims: Dimensions, material: Material, weightKg: number): number {
  const wpm = weightPerMeter(type, dims, material);
  if (wpm <= 0) return 0;
  return weightKg / wpm;
}
