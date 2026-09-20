export const describePlace = (c) => [c.city, c.state, c.country].filter(Boolean).join(", ");
