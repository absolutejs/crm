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
