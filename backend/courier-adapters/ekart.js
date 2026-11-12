// EKART — MANUAL / NOT CONFIGURED ADAPTER
// Ekart enterprise logistics API access is provided through an Ekart
// merchant/enterprise agreement. No public live API is integrated until
// Ekart issues credentials and approves pickup locations.

import { ManualPartnerAdapter } from "./manual.js";

export const ekartAdapter = new ManualPartnerAdapter({
  code: "EKART",
  name: "Ekart",
  docs: "https://www.ekartlogistics.com/",
  requiredEnv: ["EKART_CLIENT_ID", "EKART_CLIENT_SECRET", "EKART_MERCHANT_CODE"],
  optionalEnv: ["EKART_PICKUP_LOCATION", "EKART_PICKUP_PINCODE"],
  onboarding: {
    type: "contractual",
    title: "Ekart enterprise API onboarding",
    status: "not_started",
    requirements: [
      "Active Ekart enterprise/merchant account and commercial agreement.",
      "API client ID/secret and merchant code issued by Ekart.",
      "Pickup location registered and approved by Ekart.",
      "Rate card, COD remittance terms and reverse/RTO process agreed.",
      "Ekart UAT/sandbox sign-off and production IP allowlist where applicable.",
    ],
    note: "No live Ekart API call is made until these are completed and credentials are added to server-side secrets.",
  },
});

export default ekartAdapter;
