// DTDC — MANUAL / NOT CONFIGURED ADAPTER
// DTDC API access is issued through a DTDC business account/contract.
// Until API credentials and pickup approval exist, use Manual Mode.

import { ManualPartnerAdapter } from "./manual.js";

export const dtdcAdapter = new ManualPartnerAdapter({
  code: "DTDC",
  name: "DTDC",
  docs: "https://www.dtdc.in/",
  requiredEnv: ["DTDC_API_KEY", "DTDC_CUSTOMER_CODE"],
  optionalEnv: ["DTDC_PICKUP_LOCATION", "DTDC_PICKUP_PINCODE"],
  onboarding: {
    type: "contractual",
    title: "DTDC API onboarding",
    status: "not_started",
    requirements: [
      "Active DTDC business account and agreed rate card.",
      "API key and customer code issued by DTDC.",
      "Pickup registration/approval for each seller dispatch location.",
      "COD remittance and reverse/RTO terms agreed with DTDC.",
    ],
    note: "No live DTDC API call is made until these are completed and credentials are added to server-side secrets.",
  },
});

export default dtdcAdapter;
