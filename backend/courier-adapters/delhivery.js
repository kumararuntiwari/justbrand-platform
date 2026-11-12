// DELHIVERY — MANUAL / NOT CONFIGURED ADAPTER
// Delhivery API access requires a Delhivery One/business account and
// issued token. No live integration is enabled until that onboarding is
// complete and pickup locations are approved.

import { ManualPartnerAdapter } from "./manual.js";

export const delhiveryAdapter = new ManualPartnerAdapter({
  code: "DELHIVERY",
  name: "Delhivery",
  docs: "https://www.delhivery.com/",
  requiredEnv: ["DELHIVERY_API_TOKEN", "DELHIVERY_CLIENT_NAME"],
  optionalEnv: ["DELHIVERY_PICKUP_LOCATION", "DELHIVERY_PICKUP_PINCODE"],
  onboarding: {
    type: "contractual",
    title: "Delhivery API onboarding",
    status: "not_started",
    requirements: [
      "Active Delhivery One/business account and commercial agreement.",
      "API token and client name issued by Delhivery.",
      "Pickup warehouse/location registered and approved.",
      "COD, reverse pickup and RTO terms configured with Delhivery.",
    ],
    note: "No live Delhivery API call is made until these are completed and credentials are added to server-side secrets.",
  },
});

export default delhiveryAdapter;
