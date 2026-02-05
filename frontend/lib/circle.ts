import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { mustGetEnv } from "./env";

export function circleWalletClient() {
  return initiateDeveloperControlledWalletsClient({
    apiKey: mustGetEnv("CIRCLE_API_KEY"),
    entitySecret: mustGetEnv("CIRCLE_ENTITY_SECRET"),
  });
}

