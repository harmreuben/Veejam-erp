import { rebuildTestDatabase } from "./db";

export default async function setup() {
  await rebuildTestDatabase();
}
