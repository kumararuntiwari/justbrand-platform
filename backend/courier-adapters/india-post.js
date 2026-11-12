// INDIA POST — MANUAL / CONTRACTUAL ONBOARDING ADAPTER
// India Post API access is not a self-serve public courier API. The
// Department of Posts (DoP) onboards contractual e-commerce customers
// through its booking office/CEPT process. Until that onboarding gives
// JustBrand a customer ID, service contract, article-ID range, API
// credentials and server/IP approval, this adapter stays Manual Mode.

import { ManualPartnerAdapter } from "./manual.js";

export const indiaPostAdapter = new ManualPartnerAdapter({
  code: "INDIA_POST",
  name: "India Post",
  docs: "https://www.indiapost.gov.in/",
  requiredEnv: [
    "INDIA_POST_CUSTOMER_ID",
    "INDIA_POST_API_USERNAME",
    "INDIA_POST_API_PASSWORD",
    "INDIA_POST_CONTRACT_ID",
  ],
  optionalEnv: ["INDIA_POST_ARTICLE_ID_FROM", "INDIA_POST_ARTICLE_ID_TO", "INDIA_POST_PICKUP_PINCODE"],
  onboarding: {
    type: "contractual",
    title: "India Post contractual onboarding",
    status: "not_started",
    requirements: [
      "Registered business customer ID issued by the local India Post booking office.",
      "Separate service agreement/contract for Speed Post / Business Parcel (and COD where required).",
      "DoP/CEPT-issued API username/password for that customer ID (not the normal portal login).",
      "Contract ID(s) and an allotted article/barcode ID range for labels/manifests.",
      "Approved dispatch/pickup address and PIN code, with a pickup schedule agreed with DoP.",
      "Server/IP approval and UAT sign-off from India Post before production API calls.",
      "COD remittance and reconciliation terms agreed with India Post.",
    ],
    note: "These are external India Post onboarding steps. JustBrand cannot create this access by code; until completed, booking/AWB/tracking remain Manual Mode.",
  },
});

export default indiaPostAdapter;
