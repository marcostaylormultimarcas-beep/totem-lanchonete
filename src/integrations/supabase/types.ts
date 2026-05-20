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
      orders: {
        Row: {
          created_at: string
          customer_name: string
          customer_phone: string
          delivery_address: string | null
          delivery_recipient: string | null
          delivery_reference: string | null
          id: string
          items: Json
          nfe_numero: string
          nfe_status: string
          nfe_url: string
          order_number: string
          order_type: string
          organization_id: string | null
          status: string
          total: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_name: string
          customer_phone?: string
          delivery_address?: string | null
          delivery_recipient?: string | null
          delivery_reference?: string | null
          id?: string
          items?: Json
          nfe_numero?: string
          nfe_status?: string
          nfe_url?: string
          order_number: string
          order_type?: string
          organization_id?: string | null
          status?: string
          total?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_name?: string
          customer_phone?: string
          delivery_address?: string | null
          delivery_recipient?: string | null
          delivery_reference?: string | null
          id?: string
          items?: Json
          nfe_numero?: string
          nfe_status?: string
          nfe_url?: string
          order_number?: string
          order_type?: string
          organization_id?: string | null
          status?: string
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
          created_at: string
          id: string
          master_id: string | null
          name: string
          owner_id: string | null
          paused: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          master_id?: string | null
          name: string
          owner_id?: string | null
          paused?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          master_id?: string | null
          name?: string
          owner_id?: string | null
          paused?: boolean
          slug?: string
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
          name: string
          organization_id: string | null
          price: number
          removable_ingredients: Json
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
          name: string
          organization_id?: string | null
          price?: number
          removable_ingredients?: Json
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
          name?: string
          organization_id?: string | null
          price?: number
          removable_ingredients?: Json
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      redeem_loyalty_prize: { Args: { _resgate_id: string }; Returns: Json }
      set_mp_credentials: {
        Args: {
          _access_token: string
          _client_id: string
          _org: string
          _public_key: string
        }
        Returns: Json
      }
      user_owns_org: { Args: { _org: string; _uid: string }; Returns: boolean }
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
