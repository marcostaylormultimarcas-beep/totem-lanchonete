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
      cupons: {
        Row: {
          codigo: string
          created_at: string
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
          name: string
          owner_id: string | null
          paused: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id?: string | null
          paused?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string | null
          paused?: boolean
          slug?: string
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
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
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
          id: string
          instagram_url: string
          organization_id: string | null
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
          id?: string
          instagram_url?: string
          organization_id?: string | null
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
          id?: string
          instagram_url?: string
          organization_id?: string | null
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
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
