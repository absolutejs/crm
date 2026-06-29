export type {
  CRMHttpClient,
  CRMHttpMethod,
  CRMHttpRequest,
  CRMHttpResponse,
} from "./_http";
export { CRMHttpError, createFetchCRMHttpClient } from "./_http";
export {
  createAttioCRMAdapter,
  mapAttioDeal,
  mapAttioPerson,
} from "./attio";
export type { CreateAttioCRMAdapterOptions } from "./attio";
export {
  createCloseCRMAdapter,
  mapCloseContact,
  mapCloseOpportunity,
} from "./close";
export type { CreateCloseCRMAdapterOptions } from "./close";
export {
  createGoHighLevelCRMAdapter,
  listGoHighLevelInstalledLocations,
  mapGoHighLevelContact,
  mapGoHighLevelOpportunity,
} from "./gohighlevel";
export type {
  CreateGoHighLevelCRMAdapterOptions,
  GoHighLevelAgencyAuth,
  GoHighLevelAgencyCRMAdapterOptions,
  GoHighLevelInstalledLocation,
  GoHighLevelLocationCRMAdapterOptions,
} from "./gohighlevel";
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
  createMondayCRMAdapter,
  mapMondayItemToContact,
} from "./monday";
export type {
  CreateMondayCRMAdapterOptions,
  VoiceMondayColumnMapping,
} from "./monday";
export {
  createPipedriveCRMAdapter,
  mapPipedriveDealToCRM,
  mapPipedrivePersonToContact,
} from "./pipedrive";
export type { CreatePipedriveCRMAdapterOptions } from "./pipedrive";
export {
  createZohoCRMAdapter,
  mapZohoContact,
  mapZohoDeal,
} from "./zoho";
export type { CreateZohoCRMAdapterOptions } from "./zoho";
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
