export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
        }
        Relationships: []
      }
      announcements: {
        Row: {
          created_at: string
          id: string
          message: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          title?: string
        }
        Relationships: []
      }
      monitor_alerts: {
        Row: {
          category: string
          created_at: string
          details: Json | null
          id: string
          order_id: string | null
          resolved: boolean
          user_id: string | null
        }
        Insert: {
          category: string
          created_at?: string
          details?: Json | null
          id?: string
          order_id?: string | null
          resolved?: boolean
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          details?: Json | null
          id?: string
          order_id?: string | null
          resolved?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monitor_alerts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_issues: {
        Row: {
          created_at: string
          id: string
          issue_type: string
          message: string | null
          order_id: string
          resolved: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          issue_type: string
          message?: string | null
          order_id: string
          resolved?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          issue_type?: string
          message?: string | null
          order_id?: string
          resolved?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_issues_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          lot_id: string | null
          order_id: string
          product_name: string
          quantity: number
          sku: string | null
          unit_cost: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lot_id?: string | null
          order_id: string
          product_name: string
          quantity: number
          sku?: string | null
          unit_cost: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lot_id?: string | null
          order_id?: string
          product_name?: string
          quantity?: number
          sku?: string | null
          unit_cost?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "product_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_notes: {
        Row: {
          author: string | null
          created_at: string
          id: string
          note_text: string
          order_id: string
        }
        Insert: {
          author?: string | null
          created_at?: string
          id?: string
          note_text: string
          order_id: string
        }
        Update: {
          author?: string | null
          created_at?: string
          id?: string
          note_text?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          carrier: string | null
          created_at: string
          customer_email: string | null
          customer_name: string
          external_order_id: string | null
          fulfillment_cost: number
          id: string
          label_url: string | null
          order_total: number | null
          ship_city: string | null
          ship_country: string | null
          ship_name: string | null
          ship_phone: string | null
          ship_state: string | null
          ship_street: string | null
          ship_street2: string | null
          ship_zip: string | null
          shipping_cost: number
          shipstation_order_id: string | null
          source: Database["public"]["Enums"]["store_platform"]
          status: Database["public"]["Enums"]["order_status"]
          tracking_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name: string
          external_order_id?: string | null
          fulfillment_cost?: number
          id?: string
          label_url?: string | null
          order_total?: number | null
          ship_city?: string | null
          ship_country?: string | null
          ship_name?: string | null
          ship_phone?: string | null
          ship_state?: string | null
          ship_street?: string | null
          ship_street2?: string | null
          ship_zip?: string | null
          shipping_cost?: number
          shipstation_order_id?: string | null
          source?: Database["public"]["Enums"]["store_platform"]
          status?: Database["public"]["Enums"]["order_status"]
          tracking_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string
          external_order_id?: string | null
          fulfillment_cost?: number
          id?: string
          label_url?: string | null
          order_total?: number | null
          ship_city?: string | null
          ship_country?: string | null
          ship_name?: string | null
          ship_phone?: string | null
          ship_state?: string | null
          ship_street?: string | null
          ship_street2?: string | null
          ship_zip?: string | null
          shipping_cost?: number
          shipstation_order_id?: string | null
          source?: Database["public"]["Enums"]["store_platform"]
          status?: Database["public"]["Enums"]["order_status"]
          tracking_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_deposits: {
        Row: {
          amount: number
          created_at: string
          credited_at: string | null
          id: string
          invoice_url: string | null
          last_checked_at: string | null
          status: Database["public"]["Enums"]["deposit_status"]
          stripe_session_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          credited_at?: string | null
          id?: string
          invoice_url?: string | null
          last_checked_at?: string | null
          status?: Database["public"]["Enums"]["deposit_status"]
          stripe_session_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          credited_at?: string | null
          id?: string
          invoice_url?: string | null
          last_checked_at?: string | null
          status?: Database["public"]["Enums"]["deposit_status"]
          stripe_session_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      product_lots: {
        Row: {
          coa_url: string | null
          created_at: string
          expiry_date: string | null
          id: string
          lot_number: string
          quantity_on_hand: number
          received_at: string | null
          variant_id: string
        }
        Insert: {
          coa_url?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          lot_number: string
          quantity_on_hand?: number
          received_at?: string | null
          variant_id: string
        }
        Update: {
          coa_url?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          lot_number?: string
          quantity_on_hand?: number
          received_at?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_lots_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          created_at: string
          id: string
          in_stock: boolean
          product_id: string
          size: string
          sku: string
          suggested_retail: number | null
          weight_oz: number | null
          wholesale_cost: number
        }
        Insert: {
          created_at?: string
          id?: string
          in_stock?: boolean
          product_id: string
          size: string
          sku: string
          suggested_retail?: number | null
          weight_oz?: number | null
          wholesale_cost: number
        }
        Update: {
          created_at?: string
          id?: string
          in_stock?: boolean
          product_id?: string
          size?: string
          sku?: string
          suggested_retail?: number | null
          weight_oz?: number | null
          wholesale_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          ingredients: string | null
          is_active: boolean
          name: string
          serving_info: string | null
          slug: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          ingredients?: string | null
          is_active?: boolean
          name: string
          serving_info?: string | null
          slug: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          ingredients?: string | null
          is_active?: boolean
          name?: string
          serving_info?: string | null
          slug?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          brand_name: string | null
          brand_website: string | null
          created_at: string
          experience_level: string | null
          full_name: string | null
          logo_url: string | null
          onboarding_complete: boolean
          referral_code: string | null
          return_city: string | null
          return_name: string | null
          return_phone: string | null
          return_state: string | null
          return_street: string | null
          return_street2: string | null
          return_zip: string | null
          role: Database["public"]["Enums"]["user_role"]
          sales_channel: Database["public"]["Enums"]["sales_channel"] | null
          stripe_customer_id: string | null
          subscription_bypass: boolean
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_name?: string | null
          brand_website?: string | null
          created_at?: string
          experience_level?: string | null
          full_name?: string | null
          logo_url?: string | null
          onboarding_complete?: boolean
          referral_code?: string | null
          return_city?: string | null
          return_name?: string | null
          return_phone?: string | null
          return_state?: string | null
          return_street?: string | null
          return_street2?: string | null
          return_zip?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sales_channel?: Database["public"]["Enums"]["sales_channel"] | null
          stripe_customer_id?: string | null
          subscription_bypass?: boolean
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_name?: string | null
          brand_website?: string | null
          created_at?: string
          experience_level?: string | null
          full_name?: string | null
          logo_url?: string | null
          onboarding_complete?: boolean
          referral_code?: string | null
          return_city?: string | null
          return_name?: string | null
          return_phone?: string | null
          return_state?: string | null
          return_street?: string | null
          return_street2?: string | null
          return_zip?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sales_channel?: Database["public"]["Enums"]["sales_channel"] | null
          stripe_customer_id?: string | null
          subscription_bypass?: boolean
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          credited_at: string | null
          id: string
          referee_id: string | null
          referrer_credit: number
          referrer_id: string
          status: string
        }
        Insert: {
          created_at?: string
          credited_at?: string | null
          id?: string
          referee_id?: string | null
          referrer_credit?: number
          referrer_id: string
          status?: string
        }
        Update: {
          created_at?: string
          credited_at?: string | null
          id?: string
          referee_id?: string | null
          referrer_credit?: number
          referrer_id?: string
          status?: string
        }
        Relationships: []
      }
      saved_customers: {
        Row: {
          city: string | null
          email: string | null
          id: string
          last_used_at: string | null
          name: string
          state: string | null
          street: string | null
          user_id: string
          zip: string | null
        }
        Insert: {
          city?: string | null
          email?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          state?: string | null
          street?: string | null
          user_id: string
          zip?: string | null
        }
        Update: {
          city?: string | null
          email?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          state?: string | null
          street?: string | null
          user_id?: string
          zip?: string | null
        }
        Relationships: []
      }
      store_connections: {
        Row: {
          created_at: string
          credentials_encrypted: string | null
          id: string
          is_active: boolean
          last_synced_at: string | null
          platform: Database["public"]["Enums"]["store_platform"]
          store_url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          credentials_encrypted?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          platform: Database["public"]["Enums"]["store_platform"]
          store_url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          credentials_encrypted?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          platform?: Database["public"]["Enums"]["store_platform"]
          store_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_chats: {
        Row: {
          created_at: string
          id: string
          status: string
          user_id: string | null
          visitor_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          status?: string
          user_id?: string | null
          visitor_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          status?: string
          user_id?: string | null
          visitor_name?: string | null
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          body: string
          chat_id: string
          created_at: string
          id: string
          sender: string
        }
        Insert: {
          body: string
          chat_id: string
          created_at?: string
          id?: string
          sender: string
        }
        Update: {
          body?: string
          chat_id?: string
          created_at?: string
          id?: string
          sender?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "support_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          items_synced: number | null
          kind: string
          started_at: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          items_synced?: number | null
          kind: string
          started_at?: string | null
          status: string
          user_id?: string | null
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          items_synced?: number | null
          kind?: string
          started_at?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      synced_products: {
        Row: {
          connection_id: string | null
          external_id: string | null
          id: string
          image_url: string | null
          name: string | null
          price: number | null
          sku: string | null
          status: string | null
          stock_status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          external_id?: string | null
          id?: string
          image_url?: string | null
          name?: string | null
          price?: number | null
          sku?: string | null
          status?: string | null
          stock_status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string | null
          external_id?: string | null
          id?: string
          image_url?: string | null
          name?: string | null
          price?: number | null
          sku?: string | null
          status?: string | null
          stock_status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "synced_products_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "store_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          order_id: string | null
          type: Database["public"]["Enums"]["wallet_txn_type"]
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          type: Database["public"]["Enums"]["wallet_txn_type"]
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          type?: Database["public"]["Enums"]["wallet_txn_type"]
          user_id?: string
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number
          created_at: string
          id: string
          low_balance_threshold: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          id?: string
          low_balance_threshold?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          id?: string
          low_balance_threshold?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      credit_deposit: { Args: { p_deposit_id: string }; Returns: number }
      credit_wallet: {
        Args: {
          p_amount: number
          p_description?: string
          p_order_id?: string
          p_type: Database["public"]["Enums"]["wallet_txn_type"]
          p_user: string
        }
        Returns: number
      }
      debit_wallet: {
        Args: {
          p_amount: number
          p_description?: string
          p_order_id?: string
          p_user: string
        }
        Returns: boolean
      }
      fulfill_order: {
        Args: { p_order_id: string }
        Returns: Database["public"]["Enums"]["order_status"]
      }
      is_admin: { Args: never; Returns: boolean }
      order_cost: { Args: { p_order_id: string }; Returns: number }
      process_awaiting_funds: { Args: { p_user: string }; Returns: number }
      refund_order: {
        Args: { p_amount?: number; p_order_id: string; p_reason?: string }
        Returns: number
      }
    }
    Enums: {
      deposit_status: "pending" | "paid" | "failed" | "expired"
      order_status:
        | "pending"
        | "awaiting_funds"
        | "processing"
        | "shipped"
        | "delivered"
        | "fulfilled"
        | "cancelled"
        | "refunded"
      sales_channel:
        | "woocommerce"
        | "shopify"
        | "wix"
        | "social"
        | "manual"
        | "custom"
      store_platform: "woocommerce" | "shopify" | "wix" | "manual"
      subscription_status:
        | "none"
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
      user_role: "seller" | "admin"
      wallet_txn_type:
        | "deposit"
        | "debit"
        | "refund"
        | "credit"
        | "adjustment"
        | "referral"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      deposit_status: ["pending", "paid", "failed", "expired"],
      order_status: [
        "pending",
        "awaiting_funds",
        "processing",
        "shipped",
        "delivered",
        "fulfilled",
        "cancelled",
        "refunded",
      ],
      sales_channel: [
        "woocommerce",
        "shopify",
        "wix",
        "social",
        "manual",
        "custom",
      ],
      store_platform: ["woocommerce", "shopify", "wix", "manual"],
      subscription_status: [
        "none",
        "trialing",
        "active",
        "past_due",
        "canceled",
      ],
      user_role: ["seller", "admin"],
      wallet_txn_type: [
        "deposit",
        "debit",
        "refund",
        "credit",
        "adjustment",
        "referral",
      ],
    },
  },
} as const
