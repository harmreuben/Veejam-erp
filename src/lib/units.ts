/**
 * Pack and carton conversions.
 *
 * Stock is always stored in pieces (the smallest unit sold). A product defines
 * how many pieces make a pack and how many packs make a carton. Every quantity
 * a person enters (e.g. "2 cartons") is converted to pieces exactly once, here.
 */

export const SELL_UNITS = ["PIECE", "PACK", "CARTON"] as const;
export type Unit = (typeof SELL_UNITS)[number];

export type PackSizes = { unitsPerPack: number; packsPerCarton: number };

export const UNIT_LABELS: Record<Unit, { one: string; many: string; short: string }> = {
  PIECE: { one: "piece", many: "pieces", short: "pcs" },
  PACK: { one: "pack", many: "packs", short: "pk" },
  CARTON: { one: "carton", many: "cartons", short: "ctn" },
};

/** Largest quantity accepted on one line, in pieces (well inside a 32-bit integer). */
export const MAX_PIECES_PER_LINE = 100_000_000;

export function piecesPerUnit(unit: Unit, sizes: PackSizes): number {
  assertPackSizes(sizes);
  switch (unit) {
    case "PIECE":
      return 1;
    case "PACK":
      return sizes.unitsPerPack;
    case "CARTON":
      return sizes.unitsPerPack * sizes.packsPerCarton;
  }
}

/**
 * Convert a whole number of units to pieces. Fractions are rejected rather than
 * rounded, so "1.5 cartons" can never silently become a different quantity.
 */
export function toPieces(quantity: number, unit: Unit, sizes: PackSizes): number {
  if (!Number.isInteger(quantity)) {
    throw new RangeError(`Quantity must be a whole number of ${UNIT_LABELS[unit].many}, got ${quantity}`);
  }
  const pieces = quantity * piecesPerUnit(unit, sizes);
  if (!Number.isSafeInteger(pieces) || Math.abs(pieces) > MAX_PIECES_PER_LINE) {
    throw new RangeError("Quantity is too large");
  }
  return pieces;
}

/** Split pieces into cartons, packs and loose pieces: 1234 → { cartons: 2, packs: 3, pieces: 34 } for 50×10. */
export function breakdown(
  pieces: number,
  sizes: PackSizes,
): { cartons: number; packs: number; pieces: number } {
  assertPackSizes(sizes);
  const sign = pieces < 0 ? -1 : 1;
  let rest = Math.abs(pieces);
  const perCarton = sizes.unitsPerPack * sizes.packsPerCarton;
  const cartons = Math.floor(rest / perCarton);
  rest -= cartons * perCarton;
  const packs = Math.floor(rest / sizes.unitsPerPack);
  rest -= packs * sizes.unitsPerPack;
  return { cartons: sign * cartons, packs: sign * packs, pieces: sign * rest };
}

const grouped = (n: number) => n.toLocaleString("en-KE");

/** "1,234 pcs (2 ctn, 3 pk, 34 pcs)". The breakdown is left out when it adds nothing. */
export function formatQuantity(pieces: number, sizes: PackSizes): string {
  const main = `${grouped(pieces)} ${UNIT_LABELS.PIECE.short}`;
  const b = breakdown(pieces, sizes);
  if (b.cartons === 0 && b.packs === 0) return main;
  const parts = [
    b.cartons ? `${grouped(b.cartons)} ${UNIT_LABELS.CARTON.short}` : null,
    b.packs ? `${grouped(b.packs)} ${UNIT_LABELS.PACK.short}` : null,
    b.pieces ? `${grouped(b.pieces)} ${UNIT_LABELS.PIECE.short}` : null,
  ].filter(Boolean);
  return `${main} (${parts.join(", ")})`;
}

export function describePackSizes(sizes: PackSizes): string {
  return `${sizes.unitsPerPack} pcs/pack · ${sizes.packsPerCarton} packs/carton · ${
    sizes.unitsPerPack * sizes.packsPerCarton
  } pcs/carton`;
}

function assertPackSizes(sizes: PackSizes) {
  if (
    !Number.isInteger(sizes.unitsPerPack) ||
    !Number.isInteger(sizes.packsPerCarton) ||
    sizes.unitsPerPack < 1 ||
    sizes.packsPerCarton < 1
  ) {
    throw new RangeError("Pack sizes must be whole numbers of at least 1");
  }
}
