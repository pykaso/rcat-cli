export const CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'BRL', 'KRW', 'CNY', 'MXN', 'SEK', 'PLN', 'NZD', 'CHF'] as const;

export const CHART_NAMES = [
  'actives', 'actives_movement', 'actives_new', 'arr', 'churn', 'mrr', 'mrr_movement', 'revenue',
  'refund_rate', 'refund_request', 'refunds', 'non-subscription_purchases', 'subscription_status',
  'subscription_retention', 'customers_new', 'customers_active', 'conversion_to_paying',
  'initial_conversion', 'trials', 'trials_movement', 'trials_new', 'trial_conversion',
  'trial_conversion_rate', 'trial_cancellation', 'cohort_explorer', 'prediction_explorer',
  'ltv_per_customer', 'ltv_per_paying_customer', 'ad_revenue', 'ad_impressions', 'ad_clicks',
  'ad_monetized_customers', 'ad_arpdau', 'ad_rpm', 'ad_fill_rate', 'ad_ctr', 'paywall_encounter',
  'paywall_conversion', 'paywall_ltv', 'paywall_abandonment', 'app_store_save_outcomes',
] as const;

/** CLI `--type` value to the API's `revenue_type`. */
export const REVENUE_TYPES: Record<string, string> = { revenue: 'revenue', net: 'revenue_net_of_taxes', proceeds: 'proceeds' };
