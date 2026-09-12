import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace CanonicalCloud.Security;

@id("SecurityOfferCode")
enum SecurityOfferCode {
  securityReview: "security_review",
  penetrationTest: "penetration_test",
  continuousSecurity: "continuous_security",
}

@id("BillingUnit")
enum BillingUnit {
  fixed: "fixed",
  monthly: "monthly",
}

@id("CustomerSegment")
enum CustomerSegment {
  businessToBusiness: "business_to_business",
}

@id("PricingCurrency")
enum PricingCurrency {
  usd: "USD",
}

@id("CommercialAuthority")
enum CommercialAuthority {
  signedSow: "signed_sow",
}

@id("SecurityIndustryProfile")
enum SecurityIndustryProfile {
  financialServices: "financial_services",
  healthcare: "healthcare",
  cloudSaasAi: "cloud_saas_ai",
  ecommercePayments: "ecommerce_payments",
  publicSector: "public_sector",
}

@id("SecurityOffering")
model SecurityOffering {
  rank: int32;
  code: SecurityOfferCode;
  name: string;
  priceMinUsd: int32;
  priceMaxUsd: int32;
  billingUnit: BillingUnit;
  minimumTermMonths?: int32;
  deliveryWindow: string;
  coreOffer: string;
  activeTesting: boolean;
  independentAssurance: boolean;
  includedCapabilities: string[];
  exclusions: string[];
  requiredPreconditions: string[];
  industryProfiles: SecurityIndustryProfile[];
}

@id("SecurityOfferingCatalog")
model SecurityOfferingCatalog {
  schemaVersion: string;
  customerSegment: CustomerSegment;
  currency: PricingCurrency;
  commercialAuthority: CommercialAuthority;
  pricingStatus: string;
  effectiveDate: string;
  sourceDocument: string;
  offers: SecurityOffering[];
}
