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
      admins: {
        Row: {
          created_at: string
          id: string
          is_master: boolean
          organization_id: string | null
          password: string
          paused: boolean
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_master?: boolean
          organization_id?: string | null
          password: string
          paused?: boolean
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          is_master?: boolean
          organization_id?: string | null
          password?: string
          paused?: boolean
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "admins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      config_fidelidade: {
        Row: {
          ativo: boolean
          created_at: string
          descricao_premio: string
          id: string
          meta_pedidos: number
          organization_id: string
          premio_imagem: string
          premio_recompensa: string
          updated_at: string
          valor_minimo_pedido: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao_premio?: string
          id?: string
          meta_pedidos?: number
          organization_id: string
          premio_imagem?: string
          premio_recompensa?: string
          updated_at?: string
          valor_minimo_pedido?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao_premio?: string
          id?: string
          meta_pedidos?: number
          organization_id?: string
          premio_imagem?: string
          premio_recompensa?: string
          updated_at?: string
          valor_minimo_pedido?: number
        }
        Relationships: []
      }
      cupons: {
        Row: {
          codigo: string
          created_at: string
          data_fim: string | null
          data_inicio: string | null
          id: string
          organization_id: string
          status: string
          tipo: string
          updated_at: string
          valor: number
        }
        Insert: {
          codigo: string
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          id?: string
          organization_id: string
          status?: string
          tipo: string
          updated_at?: string
          valor?: number
        }
        Update: {
          codigo?: string
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          id?: string
          organization_id?: string
          status?: string
          tipo?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "cupons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      entregadores: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          organization_id: string
          password: string
          updated_at: string
          username: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          organization_id: string
          password: string
          updated_at?: string
          username: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          password?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      entregas_log: {
        Row: {
          created_at: string
          delivered_at: string
          entregador_id: string
          id: string
          order_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string
          entregador_id: string
          id?: string
          order_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          delivered_at?: string
          entregador_id?: string
          id?: string
          order_id?: string
          organization_id?: string
        }
        Relationships: []
      }
      features: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          key: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          key: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          key?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      order_cancellations: {
        Row: {
          cancelled_by: string | null
          cancelled_by_kind: string
          created_at: string
          id: string
          order_id: string
          organization_id: string
          previous_status: string
          reason: string
        }
        Insert: {
          cancelled_by?: string | null
          cancelled_by_kind: string
          created_at?: string
          id?: string
          order_id: string
          organization_id: string
          previous_status: string
          reason?: string
        }
        Update: {
          cancelled_by?: string | null
          cancelled_by_kind?: string
          created_at?: string
          id?: string
          order_id?: string
          organization_id?: string
          previous_status?: string
          reason?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          bairro_id: string | null
          bairro_nome: string
          created_at: string
          customer_cpf: string
          customer_name: string
          customer_phone: string
          data_reembolso: string | null
          delivery_address: string | null
          delivery_code: string
          delivery_fee: number
          delivery_recipient: string | null
          delivery_reference: string | null
          entregador_id: string | null
          id: string
          items: Json
          nfe_numero: string
          nfe_status: string
          nfe_url: string
          order_number: string
          order_type: string
          organization_id: string | null
          payment_method: string
          status: string
          status_reembolso: string
          total: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bairro_id?: string | null
          bairro_nome?: string
          created_at?: string
          customer_cpf?: string
          customer_name: string
          customer_phone?: string
          data_reembolso?: string | null
          delivery_address?: string | null
          delivery_code?: string
          delivery_fee?: number
          delivery_recipient?: string | null
          delivery_reference?: string | null
          entregador_id?: string | null
          id?: string
          items?: Json
          nfe_numero?: string
          nfe_status?: string
          nfe_url?: string
          order_number: string
          order_type?: string
          organization_id?: string | null
          payment_method?: string
          status?: string
          status_reembolso?: string
          total?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bairro_id?: string | null
          bairro_nome?: string
          created_at?: string
          customer_cpf?: string
          customer_name?: string
          customer_phone?: string
          data_reembolso?: string | null
          delivery_address?: string | null
          delivery_code?: string
          delivery_fee?: number
          delivery_recipient?: string | null
          delivery_reference?: string | null
          entregador_id?: string | null
          id?: string
          items?: Json
          nfe_numero?: string
          nfe_status?: string
          nfe_url?: string
          order_number?: string
          order_type?: string
          organization_id?: string | null
          payment_method?: string
          status?: string
          status_reembolso?: string
          total?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          city: string
          created_at: string
          id: string
          master_id: string | null
          name: string
          owner_id: string | null
          paused: boolean
          plan_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          city?: string
          created_at?: string
          id?: string
          master_id?: string | null
          name: string
          owner_id?: string | null
          paused?: boolean
          plan_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          city?: string
          created_at?: string
          id?: string
          master_id?: string | null
          name?: string
          owner_id?: string | null
          paused?: boolean
          plan_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      parceria_cupons: {
        Row: {
          codigo: string
          created_at: string
          customer_phone: string
          discount_percent: number
          id: string
          order_id: string
          org_origem: string
          org_parceira: string
          parceria_id: string
          used: boolean
        }
        Insert: {
          codigo: string
          created_at?: string
          customer_phone?: string
          discount_percent: number
          id?: string
          order_id: string
          org_origem: string
          org_parceira: string
          parceria_id: string
          used?: boolean
        }
        Update: {
          codigo?: string
          created_at?: string
          customer_phone?: string
          discount_percent?: number
          id?: string
          order_id?: string
          org_origem?: string
          org_parceira?: string
          parceria_id?: string
          used?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "parceria_cupons_parceria_id_fkey"
            columns: ["parceria_id"]
            isOneToOne: false
            referencedRelation: "parcerias"
            referencedColumns: ["id"]
          },
        ]
      }
      parcerias: {
        Row: {
          created_at: string
          discount_percent: number
          habilitada_origem: boolean
          habilitada_parceira: boolean
          id: string
          min_order_value: number
          org_origem: string
          org_parceira: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          discount_percent?: number
          habilitada_origem?: boolean
          habilitada_parceira?: boolean
          id?: string
          min_order_value?: number
          org_origem: string
          org_parceira: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          discount_percent?: number
          habilitada_origem?: boolean
          habilitada_parceira?: boolean
          id?: string
          min_order_value?: number
          org_origem?: string
          org_parceira?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pedidos_carimbados: {
        Row: {
          created_at: string
          order_id: string
          organization_id: string
          telefone_cliente: string
        }
        Insert: {
          created_at?: string
          order_id: string
          organization_id: string
          telefone_cliente: string
        }
        Update: {
          created_at?: string
          order_id?: string
          organization_id?: string
          telefone_cliente?: string
        }
        Relationships: []
      }
      plan_audit_log: {
        Row: {
          action: string
          actor_email: string
          actor_id: string | null
          created_at: string
          feature_id: string | null
          feature_key: string
          feature_name: string
          id: string
          new_value: boolean | null
          plan_id: string | null
          plan_key: string
          plan_name: string
          previous_value: boolean | null
        }
        Insert: {
          action: string
          actor_email?: string
          actor_id?: string | null
          created_at?: string
          feature_id?: string | null
          feature_key?: string
          feature_name?: string
          id?: string
          new_value?: boolean | null
          plan_id?: string | null
          plan_key?: string
          plan_name?: string
          previous_value?: boolean | null
        }
        Update: {
          action?: string
          actor_email?: string
          actor_id?: string | null
          created_at?: string
          feature_id?: string | null
          feature_key?: string
          feature_name?: string
          id?: string
          new_value?: boolean | null
          plan_id?: string | null
          plan_key?: string
          plan_name?: string
          previous_value?: boolean | null
        }
        Relationships: []
      }
      plan_features: {
        Row: {
          created_at: string
          enabled: boolean
          feature_id: string
          id: string
          plan_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          feature_id: string
          id?: string
          plan_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          feature_id?: string
          id?: string
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_features_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_features_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          description: string
          id: string
          key: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          key: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          key?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string
          created_at: string
          description: string
          extras: Json
          id: string
          image: string
          ingredients: Json
          is_combo: boolean | null
          low_stock_threshold: number
          manage_stock: boolean
          name: string
          organization_id: string | null
          price: number
          removable_ingredients: Json
          stock_quantity: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string
          extras?: Json
          id?: string
          image?: string
          ingredients?: Json
          is_combo?: boolean | null
          low_stock_threshold?: number
          manage_stock?: boolean
          name: string
          organization_id?: string | null
          price?: number
          removable_ingredients?: Json
          stock_quantity?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          extras?: Json
          id?: string
          image?: string
          ingredients?: Json
          is_combo?: boolean | null
          low_stock_threshold?: number
          manage_stock?: boolean
          name?: string
          organization_id?: string | null
          price?: number
          removable_ingredients?: Json
          stock_quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          phone: string | null
          recovery_pin_hash: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          recovery_pin_hash?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          recovery_pin_hash?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      progresso_fidelidade: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          premios_resgatados: number
          quantidade_carimbos: number
          telefone_cliente: string
          ultimo_pedido_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          premios_resgatados?: number
          quantidade_carimbos?: number
          telefone_cliente: string
          ultimo_pedido_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          premios_resgatados?: number
          quantidade_carimbos?: number
          telefone_cliente?: string
          ultimo_pedido_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      resgates_fidelidade: {
        Row: {
          codigo_resgate: string
          created_at: string
          id: string
          organization_id: string
          premio_imagem: string
          premio_texto: string
          status: string
          telefone_cliente: string
          used_at: string | null
          used_by_user: string | null
        }
        Insert: {
          codigo_resgate: string
          created_at?: string
          id?: string
          organization_id: string
          premio_imagem?: string
          premio_texto: string
          status?: string
          telefone_cliente: string
          used_at?: string | null
          used_by_user?: string | null
        }
        Update: {
          codigo_resgate?: string
          created_at?: string
          id?: string
          organization_id?: string
          premio_imagem?: string
          premio_texto?: string
          status?: string
          telefone_cliente?: string
          used_at?: string | null
          used_by_user?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          banners: Json
          categories: Json
          category_icons: Json
          combo: Json
          cover_image: string | null
          created_at: string
          delivery_assignment_mode: string
          delivery_enabled: boolean
          fiscal_cnpj: string
          fiscal_csc: string
          fiscal_enabled: boolean
          fiscal_ie: string
          fiscal_razao: string
          fiscal_regime: string
          fiscal_token: string
          id: string
          instagram_url: string
          mp_access_token: string
          mp_access_token_secret_id: string | null
          mp_client_id_secret_id: string | null
          mp_public_key: string
          mp_public_key_secret_id: string | null
          mp_terminal_id: string
          organization_id: string | null
          pay_card_online_enabled: boolean
          pay_card_terminal_enabled: boolean
          pay_cash_enabled: boolean
          pay_pix_enabled: boolean
          pix_key_manual: string
          share_image: string
          store_name: string
          updated_at: string
          whatsapp_number: string
        }
        Insert: {
          banners?: Json
          categories?: Json
          category_icons?: Json
          combo?: Json
          cover_image?: string | null
          created_at?: string
          delivery_assignment_mode?: string
          delivery_enabled?: boolean
          fiscal_cnpj?: string
          fiscal_csc?: string
          fiscal_enabled?: boolean
          fiscal_ie?: string
          fiscal_razao?: string
          fiscal_regime?: string
          fiscal_token?: string
          id?: string
          instagram_url?: string
          mp_access_token?: string
          mp_access_token_secret_id?: string | null
          mp_client_id_secret_id?: string | null
          mp_public_key?: string
          mp_public_key_secret_id?: string | null
          mp_terminal_id?: string
          organization_id?: string | null
          pay_card_online_enabled?: boolean
          pay_card_terminal_enabled?: boolean
          pay_cash_enabled?: boolean
          pay_pix_enabled?: boolean
          pix_key_manual?: string
          share_image?: string
          store_name?: string
          updated_at?: string
          whatsapp_number?: string
        }
        Update: {
          banners?: Json
          categories?: Json
          category_icons?: Json
          combo?: Json
          cover_image?: string | null
          created_at?: string
          delivery_assignment_mode?: string
          delivery_enabled?: boolean
          fiscal_cnpj?: string
          fiscal_csc?: string
          fiscal_enabled?: boolean
          fiscal_ie?: string
          fiscal_razao?: string
          fiscal_regime?: string
          fiscal_token?: string
          id?: string
          instagram_url?: string
          mp_access_token?: string
          mp_access_token_secret_id?: string | null
          mp_client_id_secret_id?: string | null
          mp_public_key?: string
          mp_public_key_secret_id?: string | null
          mp_terminal_id?: string
          organization_id?: string | null
          pay_card_online_enabled?: boolean
          pay_card_terminal_enabled?: boolean
          pay_cash_enabled?: boolean
          pay_pix_enabled?: boolean
          pix_key_manual?: string
          share_image?: string
          store_name?: string
          updated_at?: string
          whatsapp_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      taxas_entrega: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome_bairro: string
          organization_id: string
          tempo_estimado: number
          updated_at: string
          valor_taxa: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome_bairro: string
          organization_id: string
          tempo_estimado?: number
          updated_at?: string
          valor_taxa?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome_bairro?: string
          organization_id?: string
          tempo_estimado?: number
          updated_at?: string
          valor_taxa?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vision_prime_assinaturas: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          organization_id: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vision_prime_config: {
        Row: {
          ativo: boolean
          created_at: string
          desconto_percentual: number
          frete_gratis_minimo: number
          id: string
          organization_id: string
          updated_at: string
          valor_mensalidade: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          desconto_percentual?: number
          frete_gratis_minimo?: number
          id?: string
          organization_id: string
          updated_at?: string
          valor_mensalidade?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          desconto_percentual?: number
          frete_gratis_minimo?: number
          id?: string
          organization_id?: string
          updated_at?: string
          valor_mensalidade?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_entregador: {
        Args: { _entregador_id: string; _order_id: string }
        Returns: Json
      }
      auto_cancel_stale_pending_orders: { Args: never; Returns: number }
      cancelar_pedido: {
        Args: { _motivo?: string; _order_id: string }
        Returns: Json
      }
      confirm_delivery_with_code: {
        Args: {
          _code: string
          _entregador_id: string
          _order_id: string
          _password: string
        }
        Returns: Json
      }
      entregador_available_orders: {
        Args: { _entregador_id: string; _password: string }
        Returns: Json
      }
      entregador_claim_order: {
        Args: { _entregador_id: string; _order_id: string; _password: string }
        Returns: Json
      }
      entregador_login: {
        Args: { _org_slug: string; _password: string; _username: string }
        Returns: Json
      }
      entregador_orders: {
        Args: { _entregador_id: string; _password: string }
        Returns: Json
      }
      get_mp_access_token_internal: { Args: { _org: string }; Returns: string }
      get_mp_credentials_for_owner: { Args: { _org: string }; Returns: Json }
      grant_loyalty_stamp: { Args: { _order_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_master_admin: { Args: { _uid: string }; Returns: boolean }
      is_super_admin: { Args: { _uid: string }; Returns: boolean }
      org_has_feature: {
        Args: { _feature_key: string; _org: string }
        Returns: boolean
      }
      parceria_generate_for_order: {
        Args: { _order_id: string }
        Returns: Json
      }
      parceria_request: {
        Args: { _org_origem: string; _org_parceira: string }
        Returns: Json
      }
      parceria_respond: {
        Args: { _accept: boolean; _parceria_id: string }
        Returns: Json
      }
      parceria_set_rules: {
        Args: { _discount: number; _min_order: number; _parceria_id: string }
        Returns: Json
      }
      parceria_sweep_suspended: { Args: never; Returns: number }
      parceria_toggle: {
        Args: { _enabled: boolean; _parceria_id: string }
        Returns: Json
      }
      redeem_loyalty_prize: { Args: { _resgate_id: string }; Returns: Json }
      restock_from_items: {
        Args: { _items: Json; _org: string }
        Returns: undefined
      }
      set_mp_credentials: {
        Args: {
          _access_token: string
          _client_id: string
          _org: string
          _public_key: string
        }
        Returns: Json
      }
      toggle_plan_feature: {
        Args: { _enabled: boolean; _feature_id: string; _plan_id: string }
        Returns: Json
      }
      user_owns_org: { Args: { _org: string; _uid: string }; Returns: boolean }
      vision_prime_my_status: { Args: { _org: string }; Returns: Json }
      vision_prime_subscribe: { Args: { _org: string }; Returns: Json }
    }
    Enums: {
      app_role: "master" | "admin" | "super_admin" | "master_admin"
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
      app_role: ["master", "admin", "super_admin", "master_admin"],
    },
  },
} as const
