// XPRESSBEES — MANUAL / NOT CONFIGURED ADAPTER
// Xpressbees API access is issued to onboarded e-commerce merchants.
// Until credentials and pickup approval exist, this remains Manual Mode.

import { ManualPartnerAdapter } from "./manual.js";

export const xpressbeesAdapter = new ManualPartnerAdapter({
  code: "XPRESSBEES",
  name: "Xpressbees",
  docs: "https://www.xpressbees.com/",
  requiredEnv: ["XPRESSBEES_API_KEY", "XPRESSBEES_CUSTOMER_CODE"],
  optionalEnv: ["XPRESSBEES_PICKUP_LOCATION", "XPRESSBEES_PICKUP_PINCODE"],
  onboarding: {
    type: "contractual",
    title: "Xpressbees API onboarding",
    status: "not_started",
    requirements: [
      "Active Xpressbees merchant account and commercial agreement.",
      "API key/customer code issued by Xpressbees.",
      "Pickup location registered and approved.",
      "COD remittance, NDR and RTO process agreed.",
    ],
    note: "No live Xpressbees API call is made until these are completed and credentials are added to server-side secrets.",
  },
});

export default xpressbeesAdapter;
