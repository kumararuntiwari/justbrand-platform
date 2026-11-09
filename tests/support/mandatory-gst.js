// Shared test fixture for the production policy: KYC + PAN + Admin GST
// approval are all mandatory before a seller can list or sell.
//
// Usage: await onboardGstSeller(req, { sellerToken, staffToken });
// `req` is each suite's existing request helper (method, path, { token, body }).

export async function onboardGstSeller(
  req,
  {
    sellerToken,
    staffToken,
    pan = "AAAPZ1234C",
    gstin = "27AAPFU0939F1ZV",
    state = "Maharashtra",
  } = {}
) {
  const me = await req("GET", "/api/sellers/me", { token: sellerToken });
  const sellerId = me.data?.seller?.id;
  if (!sellerId) {
    return {
      ok: false,
      step: "seller_me",
      status: me.status,
      response: me.data,
    };
  }

  const kycDetails = await req("PUT", "/api/sellers/kyc", {
    token: sellerToken,
    body: {
      panNumber: pan,
      address: "123 GST Test Street, Mumbai",
      city: "Mumbai",
      state,
      pincode: "400001",
    },
  });
  if (kycDetails.status !== 200) {
    return { ok: false, step: "kyc_details", status: kycDetails.status, response: kycDetails.data };
  }

  const kyc = await req("PUT", `/api/admin/sellers/${sellerId}/kyc`, {
    token: staffToken,
    body: { kycStatus: "Approved" },
  });
  if (kyc.status !== 200) {
    return { ok: false, step: "kyc_approval", status: kyc.status, response: kyc.data };
  }

  const panReview = await req("PUT", `/api/admin/sellers/${sellerId}/pan`, {
    token: staffToken,
    body: { panStatus: "Verified" },
  });
  if (panReview.status !== 200) {
    return { ok: false, step: "pan_verification", status: panReview.status, response: panReview.data };
  }

  const gstSubmit = await req("POST", "/api/sellers/gst", {
    token: sellerToken,
    body: { gstin },
  });
  if (gstSubmit.status !== 200) {
    return { ok: false, step: "gst_submission", status: gstSubmit.status, response: gstSubmit.data };
  }

  const gstReview = await req("PUT", `/api/admin/sellers/${sellerId}/gst`, {
    token: staffToken,
    body: { gstStatus: "Approved" },
  });
  if (gstReview.status !== 200) {
    return { ok: false, step: "gst_approval", status: gstReview.status, response: gstReview.data };
  }

  return {
    ok: true,
    sellerId,
    status: gstReview.status,
    response: gstReview.data,
  };
}
