export {
  createHubSpotCRMAdapter,
  HUBSPOT_CONTACT_PROPERTY_NAMES,
  HUBSPOT_DEAL_PROPERTY_NAMES,
  mapHubSpotContactObject,
  mapHubSpotDealObject,
} from "./hubspot";
export type {
  CreateHubSpotCRMAdapterOptions,
  HubSpotBasicApi,
  HubSpotClientLike,
  HubSpotObjectResponse,
  HubSpotPipeline,
  HubSpotPipelineStage,
  HubSpotPipelinesApi,
  HubSpotSearchApi,
  HubSpotSearchResponse,
} from "./hubspot";
export {
  createSalesforceCRMAdapter,
  mapAccountRow as mapSalesforceAccountRow,
  mapContactRow as mapSalesforceContactRow,
  mapDealRow as mapSalesforceDealRow,
  mapLeadRow as mapSalesforceLeadRow,
} from "./salesforce";
export type {
  CreateSalesforceCRMAdapterOptions,
  SalesforceConnectionLike,
  SalesforceQueryResult,
  SalesforceSaveResult,
} from "./salesforce";
