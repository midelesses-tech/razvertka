import { NextResponse } from "next/server";
import {
  PROFILE_FIELDS,
  PROFILE_LABELS,
  MATERIAL_DENSITY,
  MATERIAL_LABELS,
  crossSectionArea,
  weightPerMeter,
  calcWeight,
  calcLength,
  type ProfileType,
  type Material,
  type Dimensions,
} from "@/lib/metal-calc";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    profiles: Object.entries(PROFILE_LABELS).map(([id, label]) => ({
      id,
      label,
      fields: PROFILE_FIELDS[id as ProfileType],
    })),
    materials: Object.entries(MATERIAL_LABELS).map(([id, label]) => ({
      id,
      label,
      density: MATERIAL_DENSITY[id as Material],
    })),
  });
}

export async function POST(req: Request) {
  let body: {
    profile?: unknown;
    material?: unknown;
    dims?: unknown;
    mode?: unknown;
    value?: unknown;
    qty?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const profile = body.profile as ProfileType;
  if (!profile || !(profile in PROFILE_LABELS)) {
    return NextResponse.json({ error: "Неверный тип профиля" }, { status: 400 });
  }

  const material = body.material as Material;
  if (!material || !(material in MATERIAL_DENSITY)) {
    return NextResponse.json({ error: "Неверный материал" }, { status: 400 });
  }

  const dims = (body.dims || {}) as Dimensions;
  const requiredFields = PROFILE_FIELDS[profile];
  for (const f of requiredFields) {
    const v = dims[f.key as keyof Dimensions];
    if (typeof v !== "number" || !isFinite(v) || v <= 0) {
      return NextResponse.json(
        { error: `Поле «${f.label}» обязательно и должно быть положительным числом` },
        { status: 400 }
      );
    }
  }

  const mode = body.mode;
  if (mode !== "weight" && mode !== "length") {
    return NextResponse.json(
      { error: "mode должен быть 'weight' или 'length'" },
      { status: 400 }
    );
  }

  const value = Number(body.value);
  if (!isFinite(value) || value <= 0) {
    return NextResponse.json(
      { error: "value должно быть положительным числом" },
      { status: 400 }
    );
  }

  const qty = typeof body.qty === "number" && body.qty > 0 ? Math.floor(body.qty) : 1;

  const area = crossSectionArea(profile, dims);
  const wpm = weightPerMeter(profile, dims, material);

  let weight: number;
  let length: number;

  if (mode === "weight") {
    // value = длина в метрах на 1 шт.
    length = value * qty;
    weight = calcWeight(profile, dims, material, value, qty);
  } else {
    // value = вес в кг, считаем длину
    length = calcLength(profile, dims, material, value);
    weight = value;
  }

  return NextResponse.json({
    mode,
    weight: Math.round(weight * 1000) / 1000,
    length: Math.round(length * 1000) / 1000,
    weightPerMeter: Math.round(wpm * 1000) / 1000,
    area: Math.round(area * 1000) / 1000,
    qty,
  });
}
