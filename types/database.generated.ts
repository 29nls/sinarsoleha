
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_logs": {
                  Row: {
                    "action_key": string,"actor_id": string | null,"after_data": Json | null,"before_data": Json | null,"created_at": string,"entity_id": string | null,"entity_name": string,"id": number,"reason": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action_key": string,"actor_id"?: string | null,"after_data"?: Json | null,"before_data"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_name": string,"id"?: never,"reason"?: string | null
                  }
                  Update: {
                    "action_key"?: string,"actor_id"?: string | null,"after_data"?: Json | null,"before_data"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_name"?: string,"id"?: never,"reason"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"id": number,"is_active": boolean,"name": string,"normalized_name": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never,"is_active"?: boolean,"name": string,"normalized_name"?: never,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"is_active"?: boolean,"name"?: string,"normalized_name"?: never,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"customers": {
                  Row: {
                    "created_at": string,"display_name": string | null,"id": string,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"id"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"id"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"document_counters": {
                  Row: {
                    "business_date": string,"last_value": number,"scope": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_date": string,"last_value"?: number,"scope": string,"updated_at"?: string
                  }
                  Update: {
                    "business_date"?: string,"last_value"?: number,"scope"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"feature_flags": {
                  Row: {
                    "enabled": boolean,"feature_key": string,"public_config": NonNullable<Json>,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "enabled"?: boolean,"feature_key": string,"public_config"?: NonNullable<Json>,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "enabled"?: boolean,"feature_key"?: string,"public_config"?: NonNullable<Json>,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "feature_flags_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"legacy_import_runs": {
                  Row: {
                    "ambiguous_rows": number,"finished_at": string | null,"id": string,"imported_by": string | null,"matched_rows": number,"notes": string | null,"source_filename": string,"source_sha256": string,"started_at": string,"status": string,"total_rows": number,"unmatched_rows": number
                  }
                  ComputedFields: never
                  Insert: {
                    "ambiguous_rows"?: number,"finished_at"?: string | null,"id"?: string,"imported_by"?: string | null,"matched_rows"?: number,"notes"?: string | null,"source_filename": string,"source_sha256": string,"started_at"?: string,"status"?: string,"total_rows"?: number,"unmatched_rows"?: number
                  }
                  Update: {
                    "ambiguous_rows"?: number,"finished_at"?: string | null,"id"?: string,"imported_by"?: string | null,"matched_rows"?: number,"notes"?: string | null,"source_filename"?: string,"source_sha256"?: string,"started_at"?: string,"status"?: string,"total_rows"?: number,"unmatched_rows"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "legacy_import_runs_imported_by_fkey"
      columns: ["imported_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"legacy_transaction_items_raw": {
                  Row: {
                    "candidate_confidence": number | null,"candidate_product_id": string | null,"created_at": string,"header_raw_id": number | null,"id": number,"line_total_raw": string | null,"match_status": string,"parsed_line_total": number | null,"parsed_quantity": number | null,"parsed_unit_price": number | null,"product_name_raw": string,"quantity_raw": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"run_id": string,"source_row_number": number,"unit_price_raw": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "candidate_confidence"?: number | null,"candidate_product_id"?: string | null,"created_at"?: string,"header_raw_id"?: number | null,"id"?: never,"line_total_raw"?: string | null,"match_status"?: string,"parsed_line_total"?: number | null,"parsed_quantity"?: number | null,"parsed_unit_price"?: number | null,"product_name_raw": string,"quantity_raw"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"run_id": string,"source_row_number": number,"unit_price_raw"?: string | null
                  }
                  Update: {
                    "candidate_confidence"?: number | null,"candidate_product_id"?: string | null,"created_at"?: string,"header_raw_id"?: number | null,"id"?: never,"line_total_raw"?: string | null,"match_status"?: string,"parsed_line_total"?: number | null,"parsed_quantity"?: number | null,"parsed_unit_price"?: number | null,"product_name_raw"?: string,"quantity_raw"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"run_id"?: string,"source_row_number"?: number,"unit_price_raw"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "legacy_transaction_items_raw_candidate_product_id_fkey"
      columns: ["candidate_product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legacy_transaction_items_raw_header_raw_id_fkey"
      columns: ["header_raw_id"]
isOneToOne: false
      referencedRelation: "legacy_transactions_raw"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legacy_transaction_items_raw_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "legacy_transaction_items_raw_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "legacy_import_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"legacy_transactions_raw": {
                  Row: {
                    "business_date_raw": string | null,"cashier_name_raw": string | null,"confidence": number | null,"created_at": string,"discount_raw": string | null,"id": number,"legacy_transaction_id_raw": string | null,"mismatch_flags": (string)[],"parse_status": string,"parsed_business_date": string | null,"parsed_total": number | null,"payment_method_raw": string | null,"run_id": string,"source_row_number": number,"subtotal_raw": string | null,"timestamp_raw": string | null,"total_raw": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_date_raw"?: string | null,"cashier_name_raw"?: string | null,"confidence"?: number | null,"created_at"?: string,"discount_raw"?: string | null,"id"?: never,"legacy_transaction_id_raw"?: string | null,"mismatch_flags"?: (string)[],"parse_status"?: string,"parsed_business_date"?: string | null,"parsed_total"?: number | null,"payment_method_raw"?: string | null,"run_id": string,"source_row_number": number,"subtotal_raw"?: string | null,"timestamp_raw"?: string | null,"total_raw"?: string | null
                  }
                  Update: {
                    "business_date_raw"?: string | null,"cashier_name_raw"?: string | null,"confidence"?: number | null,"created_at"?: string,"discount_raw"?: string | null,"id"?: never,"legacy_transaction_id_raw"?: string | null,"mismatch_flags"?: (string)[],"parse_status"?: string,"parsed_business_date"?: string | null,"parsed_total"?: number | null,"payment_method_raw"?: string | null,"run_id"?: string,"source_row_number"?: number,"subtotal_raw"?: string | null,"timestamp_raw"?: string | null,"total_raw"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "legacy_transactions_raw_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "legacy_import_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_applied": number,"cash_change": number,"cash_received": number | null,"created_at": string,"id": string,"method": string,"payment_status": string,"provider_code": string | null,"provider_reference": string | null,"transaction_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_applied": number,"cash_change"?: number,"cash_received"?: number | null,"created_at"?: string,"id"?: string,"method": string,"payment_status"?: string,"provider_code"?: string | null,"provider_reference"?: string | null,"transaction_id": string
                  }
                  Update: {
                    "amount_applied"?: number,"cash_change"?: number,"cash_received"?: number | null,"created_at"?: string,"id"?: string,"method"?: string,"payment_status"?: string,"provider_code"?: string | null,"provider_reference"?: string | null,"transaction_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_transaction_id_fkey"
      columns: ["transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"product_aliases": {
                  Row: {
                    "alias_name": string,"created_at": string,"id": number,"normalized_alias": string | null,"product_id": string,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alias_name": string,"created_at"?: string,"id"?: never,"normalized_alias"?: never,"product_id": string,"source"?: string
                  }
                  Update: {
                    "alias_name"?: string,"created_at"?: string,"id"?: never,"normalized_alias"?: never,"product_id"?: string,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_aliases_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"product_costs": {
                  Row: {
                    "product_id": string,"purchase_cost": number | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "product_id": string,"purchase_cost"?: number | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "product_id"?: string,"purchase_cost"?: number | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_costs_product_id_fkey"
      columns: ["product_id"]
isOneToOne: true
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_costs_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"product_data_issues": {
                  Row: {
                    "created_at": string,"detail": string | null,"id": number,"issue_code": string,"product_id": string,"resolved_at": string | null,"resolved_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"detail"?: string | null,"id"?: never,"issue_code": string,"product_id": string,"resolved_at"?: string | null,"resolved_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"detail"?: string | null,"id"?: never,"issue_code"?: string,"product_id"?: string,"resolved_at"?: string | null,"resolved_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_data_issues_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_data_issues_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"product_price_tiers": {
                  Row: {
                    "id": number,"is_active": boolean,"min_quantity": number,"product_id": string,"tier_key": string,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: never,"is_active"?: boolean,"min_quantity"?: number,"product_id": string,"tier_key": string,"unit_price": number
                  }
                  Update: {
                    "id"?: never,"is_active"?: boolean,"min_quantity"?: number,"product_id"?: string,"tier_key"?: string,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_price_tiers_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "category_id": number | null,"created_at": string,"id": string,"import_review_status": string,"is_active": boolean,"low_stock_threshold": number | null,"name": string,"normalized_name": string | null,"sale_price": number | null,"sku": string,"sku_normalized": string | null,"stock_on_hand": number | null,"stock_version": number,"unit_id": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: number | null,"created_at"?: string,"id"?: string,"import_review_status"?: string,"is_active"?: boolean,"low_stock_threshold"?: number | null,"name": string,"normalized_name"?: never,"sale_price"?: number | null,"sku": string,"sku_normalized"?: never,"stock_on_hand"?: number | null,"stock_version"?: number,"unit_id": number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "category_id"?: number | null,"created_at"?: string,"id"?: string,"import_review_status"?: string,"is_active"?: boolean,"low_stock_threshold"?: number | null,"name"?: string,"normalized_name"?: never,"sale_price"?: number | null,"sku"?: string,"sku_normalized"?: never,"stock_on_hand"?: number | null,"stock_version"?: number,"unit_id"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_unit_id_fkey"
      columns: ["unit_id"]
isOneToOne: false
      referencedRelation: "units_of_measure"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "activated_at": string | null,"activated_by": string | null,"created_at": string,"full_name": string,"id": string,"is_active": boolean,"role": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activated_at"?: string | null,"activated_by"?: string | null,"created_at"?: string,"full_name": string,"id": string,"is_active"?: boolean,"role"?: string,"updated_at"?: string
                  }
                  Update: {
                    "activated_at"?: string | null,"activated_by"?: string | null,"created_at"?: string,"full_name"?: string,"id"?: string,"is_active"?: boolean,"role"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_activated_by_fkey"
      columns: ["activated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_discrepancy_logs": {
                  Row: {
                    "approved_by": string | null,"created_at": string,"created_by": string,"difference_qty": number,"id": number,"physical_qty": number,"product_id": string,"reason_code": string,"reason_note": string | null,"revision": number,"stock_opname_item_id": string,"system_qty": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_by"?: string | null,"created_at"?: string,"created_by": string,"difference_qty": number,"id"?: never,"physical_qty": number,"product_id": string,"reason_code": string,"reason_note"?: string | null,"revision"?: number,"stock_opname_item_id": string,"system_qty": number
                  }
                  Update: {
                    "approved_by"?: string | null,"created_at"?: string,"created_by"?: string,"difference_qty"?: number,"id"?: never,"physical_qty"?: number,"product_id"?: string,"reason_code"?: string,"reason_note"?: string | null,"revision"?: number,"stock_opname_item_id"?: string,"system_qty"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_discrepancy_logs_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_discrepancy_logs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_discrepancy_logs_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_discrepancy_logs_stock_opname_item_id_fkey"
      columns: ["stock_opname_item_id"]
isOneToOne: false
      referencedRelation: "stock_opname_items"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_movements": {
                  Row: {
                    "actor_id": string,"created_at": string,"id": number,"idempotency_key": string | null,"movement_type": string,"product_id": string,"quantity_after": number,"quantity_before": number | null,"quantity_delta": number,"reason_code": string | null,"reason_note": string | null,"stock_opname_id": string | null,"transaction_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"created_at"?: string,"id"?: never,"idempotency_key"?: string | null,"movement_type": string,"product_id": string,"quantity_after": number,"quantity_before"?: number | null,"quantity_delta": number,"reason_code"?: string | null,"reason_note"?: string | null,"stock_opname_id"?: string | null,"transaction_id"?: string | null
                  }
                  Update: {
                    "actor_id"?: string,"created_at"?: string,"id"?: never,"idempotency_key"?: string | null,"movement_type"?: string,"product_id"?: string,"quantity_after"?: number,"quantity_before"?: number | null,"quantity_delta"?: number,"reason_code"?: string | null,"reason_note"?: string | null,"stock_opname_id"?: string | null,"transaction_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_movements_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_stock_opname_id_fkey"
      columns: ["stock_opname_id"]
isOneToOne: false
      referencedRelation: "stock_opnames"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_transaction_id_fkey"
      columns: ["transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_opname_items": {
                  Row: {
                    "count_status": string,"counted_at": string | null,"counted_by": string | null,"created_at": string,"difference_qty": number | null,"id": string,"physical_qty": number | null,"product_id": string,"reason_code": string | null,"reason_note": string | null,"stock_opname_id": string,"stock_version_snapshot": number,"system_qty_snapshot": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count_status"?: string,"counted_at"?: string | null,"counted_by"?: string | null,"created_at"?: string,"difference_qty"?: never,"id"?: string,"physical_qty"?: number | null,"product_id": string,"reason_code"?: string | null,"reason_note"?: string | null,"stock_opname_id": string,"stock_version_snapshot": number,"system_qty_snapshot"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "count_status"?: string,"counted_at"?: string | null,"counted_by"?: string | null,"created_at"?: string,"difference_qty"?: never,"id"?: string,"physical_qty"?: number | null,"product_id"?: string,"reason_code"?: string | null,"reason_note"?: string | null,"stock_opname_id"?: string,"stock_version_snapshot"?: number,"system_qty_snapshot"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_opname_items_counted_by_fkey"
      columns: ["counted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_opname_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_opname_items_stock_opname_id_fkey"
      columns: ["stock_opname_id"]
isOneToOne: false
      referencedRelation: "stock_opnames"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_opnames": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"cancelled_reason": string | null,"created_at": string,"created_by": string,"id": string,"opname_no": string,"posted_at": string | null,"posted_by": string | null,"scope_note": string | null,"status": string,"submitted_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"cancelled_reason"?: string | null,"created_at"?: string,"created_by": string,"id"?: string,"opname_no": string,"posted_at"?: string | null,"posted_by"?: string | null,"scope_note"?: string | null,"status"?: string,"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"cancelled_reason"?: string | null,"created_at"?: string,"created_by"?: string,"id"?: string,"opname_no"?: string,"posted_at"?: string | null,"posted_by"?: string | null,"scope_note"?: string | null,"status"?: string,"submitted_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_opnames_approved_by_fkey"
      columns: ["approved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_opnames_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_opnames_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_opnames_posted_by_fkey"
      columns: ["posted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"transaction_items": {
                  Row: {
                    "created_at": string,"id": string,"line_discount_amount": number,"line_subtotal": number,"line_total": number,"product_id": string | null,"product_name_snapshot": string,"quantity": number,"sku_snapshot": string,"transaction_id": string,"unit_label_snapshot": string,"unit_price": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"line_discount_amount"?: number,"line_subtotal": number,"line_total": number,"product_id"?: string | null,"product_name_snapshot": string,"quantity": number,"sku_snapshot": string,"transaction_id": string,"unit_label_snapshot": string,"unit_price": number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"line_discount_amount"?: number,"line_subtotal"?: number,"line_total"?: number,"product_id"?: string | null,"product_name_snapshot"?: string,"quantity"?: number,"sku_snapshot"?: string,"transaction_id"?: string,"unit_label_snapshot"?: string,"unit_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "transaction_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transaction_items_transaction_id_fkey"
      columns: ["transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["id"]
    }
                  ]
                },"transactions": {
                  Row: {
                    "business_date": string,"cashier_id": string,"completed_at": string,"created_at": string,"customer_id": string | null,"discount_amount": number,"grand_total": number,"id": string,"idempotency_key": string | null,"legacy_transaction_id": string | null,"note": string | null,"receipt_no": string,"reconciliation_status": string,"status": string,"subtotal": number,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_date": string,"cashier_id": string,"completed_at"?: string,"created_at"?: string,"customer_id"?: string | null,"discount_amount"?: number,"grand_total": number,"id"?: string,"idempotency_key"?: string | null,"legacy_transaction_id"?: string | null,"note"?: string | null,"receipt_no": string,"reconciliation_status"?: string,"status"?: string,"subtotal": number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "business_date"?: string,"cashier_id"?: string,"completed_at"?: string,"created_at"?: string,"customer_id"?: string | null,"discount_amount"?: number,"grand_total"?: number,"id"?: string,"idempotency_key"?: string | null,"legacy_transaction_id"?: string | null,"note"?: string | null,"receipt_no"?: string,"reconciliation_status"?: string,"status"?: string,"subtotal"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "transactions_cashier_id_fkey"
      columns: ["cashier_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transactions_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transactions_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"units_of_measure": {
                  Row: {
                    "code": string,"created_at": string,"decimal_scale": number,"id": number,"is_active": boolean,"label": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"decimal_scale"?: number,"id"?: never,"is_active"?: boolean,"label": string,"updated_at"?: string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"decimal_scale"?: number,"id"?: never,"is_active"?: boolean,"label"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_upsert_profile":
{ Args: { "p_full_name": string,"p_is_active": boolean,"p_role": string,"p_user_id": string }; Returns: Json
                           },
"set_feature_flag":
{ Args: { "p_enabled": boolean,"p_feature_key": string,"p_public_config": Json }; Returns: Json
                           },
"set_product_cost":
{ Args: { "p_product_id": string,"p_purchase_cost": number }; Returns: Json
                           },
"upsert_category":
{ Args: { "p_payload": Json }; Returns: Json
                           },
"upsert_product":
{ Args: { "p_payload": Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
