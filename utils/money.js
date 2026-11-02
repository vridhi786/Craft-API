// All money maths is done in integer paise to avoid floating-point drift.
export const toPaise = (rupees) => Math.round(Number(rupees) * 100);
export const fromPaise = (paise) => Math.round(paise) / 100;
export const percentOfPaise = (paise, percent) => Math.floor((paise * percent) / 100);
export const discountPercent = (mrp, price) => (mrp > price && mrp > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0);
