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
        Relationships: []
      }
      ai_suggestions_history: {
        Row: {
          acted_at: string | null
          audience_size: number
          category: string
          conversions: number
          created_at: string
          dismiss_reason: string
          dispatched_at: string | null
          generated_at: string
          id: string
          last_conversion_check: string | null
          notifications_sent: number
          organization_id: string
          priority: number
          reason: string
          status: string
          suggestion_key: string
          template: string
          title: string
          updated_at: string
        }
        Insert: {
          acted_at?: string | null
          audience_size?: number
          category?: string
          conversions?: number
          created_at?: string
          dismiss_reason?: string
          dispatched_at?: string | null
          generated_at?: string
          id?: string
          last_conversion_check?: string | null
          notifications_sent?: number
          organization_id: string
          priority?: number
          reason?: string
          status?: string
          suggestion_key: string
          template?: string
          title?: string
          updated_at?: string
        }
        Update: {
          acted_at?: string | null
          audience_size?: number
          category?: string
          conversions?: number
          created_at?: string
          dismiss_reason?: string
          dispatched_at?: string | null
          generated_at?: string
          id?: string
          last_conversion_check?: string | null
          notifications_sent?: number
          organization_id?: string
          priority?: number
          reason?: string
          status?: string
          suggestion_key?: string
          template?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_suggestions_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      alertas_estoque: {
        Row: {
          created_at: string
          id: string
          ingrediente_id: string | null
          mensagem: string
          organization_id: string
          product_id: string | null
          resolvido: boolean
          tipo: string
          webhook_error: string
          webhook_status: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingrediente_id?: string | null
          mensagem?: string
          organization_id: string
          product_id?: string | null
          resolvido?: boolean
          tipo?: string
          webhook_error?: string
          webhook_status?: string
        }
        Update: {
          created_at?: string
          id?: string
          ingrediente_id?: string | null
          mensagem?: string
          organization_id?: string
          product_id?: string | null
          resolvido?: boolean
          tipo?: string
          webhook_error?: string
          webhook_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "alertas_estoque_ingrediente_id_fkey"
            columns: ["ingrediente_id"]
            isOneToOne: false
            referencedRelation: "ingredientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_estoque_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_estoque_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      assinaturas_loja: {
        Row: {
          beneficios: string[] | null
          created_at: string
          id: string
          nome_plano: string | null
          organization_id: string | null
          status: string | null
          valor: number | null
        }
        Insert: {
          beneficios?: string[] | null
          created_at?: string
          id?: string
          nome_plano?: string | null
          organization_id?: string | null
          status?: string | null
          valor?: number | null
        }
        Update: {
          beneficios?: string[] | null
          created_at?: string
          id?: string
          nome_plano?: string | null
          organization_id?: string | null
          status?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      assistente_vision_feedback: {
        Row: {
          action: string
          created_at: string
          id: string
          message_sent: string
          organization_id: string
          reason: string
          suggestion_key: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          message_sent?: string
          organization_id: string
          reason?: string
          suggestion_key: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          message_sent?: string
          organization_id?: string
          reason?: string
          suggestion_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistente_vision_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bairros: {
        Row: {
          created_at: string
          id: string
          loja_id: string
          nome: string
          taxa: number
        }
        Insert: {
          created_at?: string
          id?: string
          loja_id: string
          nome: string
          taxa?: number
        }
        Update: {
          created_at?: string
          id?: string
          loja_id?: string
          nome?: string
          taxa?: number
        }
        Relationships: [
          {
            foreignKeyName: "bairros_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      bairros_atendidos: {
        Row: {
          ativo: boolean
          bairro: string
          cidade: string | null
          created_at: string
          id: string
          organization_id: string
          taxa: number
          tempo_min: number
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          bairro: string
          cidade?: string | null
          created_at?: string
          id?: string
          organization_id: string
          taxa?: number
          tempo_min?: number
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          bairro?: string
          cidade?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          taxa?: number
          tempo_min?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bairros_atendidos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      caixa_movimentos: {
        Row: {
          caixa_id: string
          created_at: string
          forma_pagamento: string
          id: string
          metadata: Json
          motivo: string | null
          operador_id: string
          operador_nome: string
          organization_id: string
          pedido_id: string | null
          tipo: string
          valor: number
        }
        Insert: {
          caixa_id: string
          created_at?: string
          forma_pagamento?: string
          id?: string
          metadata?: Json
          motivo?: string | null
          operador_id: string
          operador_nome?: string
          organization_id: string
          pedido_id?: string | null
          tipo: string
          valor?: number
        }
        Update: {
          caixa_id?: string
          created_at?: string
          forma_pagamento?: string
          id?: string
          metadata?: Json
          motivo?: string | null
          operador_id?: string
          operador_nome?: string
          organization_id?: string
          pedido_id?: string | null
          tipo?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "caixa_movimentos_caixa_id_fkey"
            columns: ["caixa_id"]
            isOneToOne: false
            referencedRelation: "caixas_pdv"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caixa_movimentos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caixa_movimentos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caixa_movimentos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "v_financeiro_detalhado"
            referencedColumns: ["order_id"]
          },
        ]
      }
      caixas_pdv: {
        Row: {
          abertura_at: string
          created_at: string
          fechamento_at: string | null
          id: string
          operador_id: string
          organization_id: string
          resumo: Json
          saldo_final: number | null
          saldo_inicial: number
          status: string
          updated_at: string
        }
        Insert: {
          abertura_at?: string
          created_at?: string
          fechamento_at?: string | null
          id?: string
          operador_id: string
          organization_id: string
          resumo?: Json
          saldo_final?: number | null
          saldo_inicial?: number
          status?: string
          updated_at?: string
        }
        Update: {
          abertura_at?: string
          created_at?: string
          fechamento_at?: string | null
          id?: string
          operador_id?: string
          organization_id?: string
          resumo?: Json
          saldo_final?: number | null
          saldo_inicial?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "caixas_pdv_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cancelamentos_pedido: {
        Row: {
          cancelado_por: string | null
          cancelado_por_tipo: string
          created_at: string
          id: string
          motivo: string | null
          organization_id: string
          pedido_id: string
          status_anterior: string
        }
        Insert: {
          cancelado_por?: string | null
          cancelado_por_tipo?: string
          created_at?: string
          id?: string
          motivo?: string | null
          organization_id: string
          pedido_id: string
          status_anterior: string
        }
        Update: {
          cancelado_por?: string | null
          cancelado_por_tipo?: string
          created_at?: string
          id?: string
          motivo?: string | null
          organization_id?: string
          pedido_id?: string
          status_anterior?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancelamentos_pedido_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancelamentos_pedido_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome: string
          ordem: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome: string
          ordem?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome?: string
          ordem?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cep_atendidos: {
        Row: {
          cep: string | null
          created_at: string | null
          id: string
          organization_id: string | null
          taxa: number | null
          tempo_estimado: number | null
          tempo_min: number | null
        }
        Insert: {
          cep?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          taxa?: number | null
          tempo_estimado?: number | null
          tempo_min?: number | null
        }
        Update: {
          cep?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          taxa?: number | null
          tempo_estimado?: number | null
          tempo_min?: number | null
        }
        Relationships: []
      }
      ceps_atendidos: {
        Row: {
          ativo: boolean
          cep_fim: string
          cep_inicio: string
          created_at: string
          id: string
          organization_id: string
          taxa: number
          tempo_min: number
        }
        Insert: {
          ativo?: boolean
          cep_fim: string
          cep_inicio: string
          created_at?: string
          id?: string
          organization_id: string
          taxa?: number
          tempo_min?: number
        }
        Update: {
          ativo?: boolean
          cep_fim?: string
          cep_inicio?: string
          created_at?: string
          id?: string
          organization_id?: string
          taxa?: number
          tempo_min?: number
        }
        Relationships: [
          {
            foreignKeyName: "ceps_atendidos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          name: string | null
          nome: string | null
          phone: string | null
          telefone: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          nome?: string | null
          phone?: string | null
          telefone?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          nome?: string | null
          phone?: string | null
          telefone?: string | null
        }
        Relationships: []
      }
      config_fidelidade: {
        Row: {
          ativo: boolean
          created_at: string
          data_fim: string | null
          data_inicio: string | null
          descricao_premio: string | null
          earning_mode: string
          id: string
          meta_pedidos: number
          organization_id: string
          points_per_order: number
          points_per_real: number
          premio_imagem: string | null
          premio_recompensa: string | null
          updated_at: string
          valor_minimo_pedido: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          descricao_premio?: string | null
          earning_mode?: string
          id?: string
          meta_pedidos?: number
          organization_id: string
          points_per_order?: number
          points_per_real?: number
          premio_imagem?: string | null
          premio_recompensa?: string | null
          updated_at?: string
          valor_minimo_pedido?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          descricao_premio?: string | null
          earning_mode?: string
          id?: string
          meta_pedidos?: number
          organization_id?: string
          points_per_order?: number
          points_per_real?: number
          premio_imagem?: string | null
          premio_recompensa?: string | null
          updated_at?: string
          valor_minimo_pedido?: number
        }
        Relationships: [
          {
            foreignKeyName: "config_fidelidade_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      config_impressao: {
        Row: {
          abrir_gaveta: boolean
          agent_token: string | null
          ativo: boolean
          cortar_papel: boolean
          created_at: string
          id: string
          impressora_nome: string | null
          largura_colunas: number
          metadata: Json
          organization_id: string
          ultimo_ping_at: string | null
          updated_at: string
        }
        Insert: {
          abrir_gaveta?: boolean
          agent_token?: string | null
          ativo?: boolean
          cortar_papel?: boolean
          created_at?: string
          id?: string
          impressora_nome?: string | null
          largura_colunas?: number
          metadata?: Json
          organization_id: string
          ultimo_ping_at?: string | null
          updated_at?: string
        }
        Update: {
          abrir_gaveta?: boolean
          agent_token?: string | null
          ativo?: boolean
          cortar_papel?: boolean
          created_at?: string
          id?: string
          impressora_nome?: string | null
          largura_colunas?: number
          metadata?: Json
          organization_id?: string
          ultimo_ping_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "config_impressao_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes: {
        Row: {
          aceita_delivery: boolean
          aceita_mesa: boolean
          aceita_retirada: boolean
          cor_primaria: string | null
          created_at: string
          id: string
          instagram_url: string | null
          metadata: Json
          modo_atribuicao_entrega: string
          mp_access_token: string | null
          mp_access_token_secret_id: string | null
          mp_client_id: string | null
          mp_client_id_secret_id: string | null
          mp_public_key: string | null
          mp_public_key_secret_id: string | null
          nome_loja: string | null
          organization_id: string
          pedido_minimo: number
          taxa_entrega_padrao: number
          tempo_preparo_min: number
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          aceita_delivery?: boolean
          aceita_mesa?: boolean
          aceita_retirada?: boolean
          cor_primaria?: string | null
          created_at?: string
          id?: string
          instagram_url?: string | null
          metadata?: Json
          modo_atribuicao_entrega?: string
          mp_access_token?: string | null
          mp_access_token_secret_id?: string | null
          mp_client_id?: string | null
          mp_client_id_secret_id?: string | null
          mp_public_key?: string | null
          mp_public_key_secret_id?: string | null
          nome_loja?: string | null
          organization_id: string
          pedido_minimo?: number
          taxa_entrega_padrao?: number
          tempo_preparo_min?: number
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          aceita_delivery?: boolean
          aceita_mesa?: boolean
          aceita_retirada?: boolean
          cor_primaria?: string | null
          created_at?: string
          id?: string
          instagram_url?: string | null
          metadata?: Json
          modo_atribuicao_entrega?: string
          mp_access_token?: string | null
          mp_access_token_secret_id?: string | null
          mp_client_id?: string | null
          mp_client_id_secret_id?: string | null
          mp_public_key?: string | null
          mp_public_key_secret_id?: string | null
          nome_loja?: string | null
          organization_id?: string
          pedido_minimo?: number
          taxa_entrega_padrao?: number
          tempo_preparo_min?: number
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "configuracoes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes_impressao: {
        Row: {
          active: boolean | null
          agent_token_hash: string | null
          ativo: boolean | null
          auto_print: boolean | null
          created_at: string | null
          enabled: boolean | null
          id: string
          impressao_automatica: boolean | null
          largura_papel: string | null
          last_seen_at: string | null
          organization_id: string | null
          paper_width: number
          printer_ip: string
          printer_port: number
          status: boolean | null
          token: string | null
          token_agente: string | null
          updated_at: string
          webhook_alerta_url: string
          webhook_url: string | null
        }
        Insert: {
          active?: boolean | null
          agent_token_hash?: string | null
          ativo?: boolean | null
          auto_print?: boolean | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          impressao_automatica?: boolean | null
          largura_papel?: string | null
          last_seen_at?: string | null
          organization_id?: string | null
          paper_width?: number
          printer_ip?: string
          printer_port?: number
          status?: boolean | null
          token?: string | null
          token_agente?: string | null
          updated_at?: string
          webhook_alerta_url?: string
          webhook_url?: string | null
        }
        Update: {
          active?: boolean | null
          agent_token_hash?: string | null
          ativo?: boolean | null
          auto_print?: boolean | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          impressao_automatica?: boolean | null
          largura_papel?: string | null
          last_seen_at?: string | null
          organization_id?: string | null
          paper_width?: number
          printer_ip?: string
          printer_port?: number
          status?: boolean | null
          token?: string | null
          token_agente?: string | null
          updated_at?: string
          webhook_alerta_url?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      configuracoes_loja: {
        Row: {
          id: string
          impressao_automatica: boolean | null
          limite_alertas: number | null
          loja_id: string
          taxa_bairro_padrao: number | null
          updated_at: string
        }
        Insert: {
          id?: string
          impressao_automatica?: boolean | null
          limite_alertas?: number | null
          loja_id: string
          taxa_bairro_padrao?: number | null
          updated_at?: string
        }
        Update: {
          id?: string
          impressao_automatica?: boolean | null
          limite_alertas?: number | null
          loja_id?: string
          taxa_bairro_padrao?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "configuracoes_loja_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: true
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      cupons: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          data_fim: string | null
          data_inicio: string | null
          id: string
          minimo_pedido: number
          organization_id: string
          status: boolean | null
          tipo: string | null
          tipo_desconto: string
          updated_at: string
          usos: number
          validade: string | null
          valor: number
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          id?: string
          minimo_pedido?: number
          organization_id: string
          status?: boolean | null
          tipo?: string | null
          tipo_desconto?: string
          updated_at?: string
          usos?: number
          validade?: string | null
          valor?: number
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          id?: string
          minimo_pedido?: number
          organization_id?: string
          status?: boolean | null
          tipo?: string | null
          tipo_desconto?: string
          updated_at?: string
          usos?: number
          validade?: string | null
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
      customers: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          name: string | null
          organization_id: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          organization_id?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          organization_id?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      entregador_sessions: {
        Row: {
          created_at: string
          entregador_id: string
          expires_at: string
          id: string
          last_used_at: string
          organization_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          entregador_id: string
          expires_at?: string
          id?: string
          last_used_at?: string
          organization_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          entregador_id?: string
          expires_at?: string
          id?: string
          last_used_at?: string
          organization_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "entregador_sessions_entregador_id_fkey"
            columns: ["entregador_id"]
            isOneToOne: false
            referencedRelation: "entregadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregador_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      entregadores: {
        Row: {
          active: boolean | null
          ativo: boolean
          created_at: string
          id: string
          name: string | null
          nome: string | null
          organization_id: string
          password: string | null
          senha: string | null
          telefone: string | null
          ultima_lat: number | null
          ultima_lng: number | null
          ultima_localizacao_at: string | null
          ultima_localizacao_pedido_id: string | null
          updated_at: string
          username: string | null
          usuario: string | null
        }
        Insert: {
          active?: boolean | null
          ativo?: boolean
          created_at?: string
          id?: string
          name?: string | null
          nome?: string | null
          organization_id: string
          password?: string | null
          senha?: string | null
          telefone?: string | null
          ultima_lat?: number | null
          ultima_lng?: number | null
          ultima_localizacao_at?: string | null
          ultima_localizacao_pedido_id?: string | null
          updated_at?: string
          username?: string | null
          usuario?: string | null
        }
        Update: {
          active?: boolean | null
          ativo?: boolean
          created_at?: string
          id?: string
          name?: string | null
          nome?: string | null
          organization_id?: string
          password?: string | null
          senha?: string | null
          telefone?: string | null
          ultima_lat?: number | null
          ultima_lng?: number | null
          ultima_localizacao_at?: string | null
          ultima_localizacao_pedido_id?: string | null
          updated_at?: string
          username?: string | null
          usuario?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entregadores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "entregas_log_entregador_id_fkey"
            columns: ["entregador_id"]
            isOneToOne: false
            referencedRelation: "entregadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_financeiro_detalhado"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "entregas_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      features: {
        Row: {
          category: string
          description: string | null
          id: string
          key: string
          name: string
          sort_order: number | null
        }
        Insert: {
          category: string
          description?: string | null
          id?: string
          key: string
          name: string
          sort_order?: number | null
        }
        Update: {
          category?: string
          description?: string | null
          id?: string
          key?: string
          name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      ingredientes: {
        Row: {
          alerta_vencimento: boolean | null
          created_at: string
          custo_unitario: number
          data_vencimento: string | null
          disponivel: boolean
          estoque_atual: number
          estoque_inicial: number | null
          estoque_minimo: number
          expiration_date: string | null
          id: string
          lote: string | null
          metadata: Json
          minimo: number | null
          nome: string
          organization_id: string
          ultimo_alerta_at: string | null
          unidade: string
          updated_at: string
          validade: string | null
          vencimento: string | null
        }
        Insert: {
          alerta_vencimento?: boolean | null
          created_at?: string
          custo_unitario?: number
          data_vencimento?: string | null
          disponivel?: boolean
          estoque_atual?: number
          estoque_inicial?: number | null
          estoque_minimo?: number
          expiration_date?: string | null
          id?: string
          lote?: string | null
          metadata?: Json
          minimo?: number | null
          nome: string
          organization_id: string
          ultimo_alerta_at?: string | null
          unidade?: string
          updated_at?: string
          validade?: string | null
          vencimento?: string | null
        }
        Update: {
          alerta_vencimento?: boolean | null
          created_at?: string
          custo_unitario?: number
          data_vencimento?: string | null
          disponivel?: boolean
          estoque_atual?: number
          estoque_inicial?: number | null
          estoque_minimo?: number
          expiration_date?: string | null
          id?: string
          lote?: string | null
          metadata?: Json
          minimo?: number | null
          nome?: string
          organization_id?: string
          ultimo_alerta_at?: string | null
          unidade?: string
          updated_at?: string
          validade?: string | null
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredientes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      itens_pedido: {
        Row: {
          created_at: string
          id: string
          observacoes: string | null
          pedido_id: string
          preco_unitario: number
          produto_id: string | null
          quantidade: number
        }
        Insert: {
          created_at?: string
          id?: string
          observacoes?: string | null
          pedido_id: string
          preco_unitario: number
          produto_id?: string | null
          quantidade: number
        }
        Update: {
          created_at?: string
          id?: string
          observacoes?: string | null
          pedido_id?: string
          preco_unitario?: number
          produto_id?: string | null
          quantidade?: number
        }
        Relationships: []
      }
      logs_impressao: {
        Row: {
          created_at: string
          id: string
          message: string
          order_id: string | null
          organization_id: string
          payload_size: number
          printer_ip: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string
          order_id?: string | null
          organization_id: string
          payload_size?: number
          printer_ip?: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          order_id?: string | null
          organization_id?: string
          payload_size?: number
          printer_ip?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "logs_impressao_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_impressao_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_financeiro_detalhado"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "logs_impressao_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loja_temas: {
        Row: {
          cor_primaria: string | null
          cor_secundaria: string | null
          created_at: string | null
          dark_mode: boolean | null
          id: string
          mode: string | null
          modo_app: string | null
          organization_id: string | null
          primary_color: string | null
          secondary_color: string | null
          tema: string | null
          theme: string | null
        }
        Insert: {
          cor_primaria?: string | null
          cor_secundaria?: string | null
          created_at?: string | null
          dark_mode?: boolean | null
          id?: string
          mode?: string | null
          modo_app?: string | null
          organization_id?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          tema?: string | null
          theme?: string | null
        }
        Update: {
          cor_primaria?: string | null
          cor_secundaria?: string | null
          created_at?: string | null
          dark_mode?: boolean | null
          id?: string
          mode?: string | null
          modo_app?: string | null
          organization_id?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          tema?: string | null
          theme?: string | null
        }
        Relationships: []
      }
      lojas: {
        Row: {
          cor_premium: string | null
          created_at: string
          id: string
          logo_url: string | null
          nome: string
          slug: string
        }
        Insert: {
          cor_premium?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          nome: string
          slug: string
        }
        Update: {
          cor_premium?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          nome?: string
          slug?: string
        }
        Relationships: []
      }
      loyalty_points_ledger: {
        Row: {
          balance_after: number
          created_at: string
          description: string
          eligible_amount: number | null
          entry_type: string
          id: string
          order_id: string | null
          organization_id: string
          points: number
          redemption_id: string | null
          reward_id: string | null
          telefone_cliente: string
          user_id: string | null
        }
        Insert: {
          balance_after: number
          created_at?: string
          description?: string
          eligible_amount?: number | null
          entry_type: string
          id?: string
          order_id?: string | null
          organization_id: string
          points: number
          redemption_id?: string | null
          reward_id?: string | null
          telefone_cliente?: string
          user_id?: string | null
        }
        Update: {
          balance_after?: number
          created_at?: string
          description?: string
          eligible_amount?: number | null
          entry_type?: string
          id?: string
          order_id?: string | null
          organization_id?: string
          points?: number
          redemption_id?: string | null
          reward_id?: string | null
          telefone_cliente?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_points_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_financeiro_detalhado"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "loyalty_points_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_ledger_redemption_id_fkey"
            columns: ["redemption_id"]
            isOneToOne: false
            referencedRelation: "resgates_fidelidade"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_points_ledger_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "loyalty_rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_rewards: {
        Row: {
          active: boolean
          created_at: string
          description: string
          estimated_cost: number | null
          id: string
          image_url: string
          organization_id: string
          points_cost: number
          product_id: string | null
          reward_type: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          estimated_cost?: number | null
          id?: string
          image_url?: string
          organization_id: string
          points_cost: number
          product_id?: string | null
          reward_type?: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          estimated_cost?: number | null
          id?: string
          image_url?: string
          organization_id?: string
          points_cost?: number
          product_id?: string | null
          reward_type?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_rewards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_rewards_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      operadores: {
        Row: {
          active: boolean | null
          ativo: boolean | null
          created_at: string | null
          email: string | null
          id: string
          login: string | null
          name: string | null
          nome: string | null
          organization_id: string | null
          password: string | null
          permissions: Json | null
          pin: string | null
          profile_id: string | null
          restaurant_id: string | null
          role: string | null
          senha: string | null
          store_id: string | null
          user_id: string | null
          username: string | null
          usuario: string | null
        }
        Insert: {
          active?: boolean | null
          ativo?: boolean | null
          created_at?: string | null
          email?: string | null
          id?: string
          login?: string | null
          name?: string | null
          nome?: string | null
          organization_id?: string | null
          password?: string | null
          permissions?: Json | null
          pin?: string | null
          profile_id?: string | null
          restaurant_id?: string | null
          role?: string | null
          senha?: string | null
          store_id?: string | null
          user_id?: string | null
          username?: string | null
          usuario?: string | null
        }
        Update: {
          active?: boolean | null
          ativo?: boolean | null
          created_at?: string | null
          email?: string | null
          id?: string
          login?: string | null
          name?: string | null
          nome?: string | null
          organization_id?: string | null
          password?: string | null
          permissions?: Json | null
          pin?: string | null
          profile_id?: string | null
          restaurant_id?: string | null
          role?: string | null
          senha?: string | null
          store_id?: string | null
          user_id?: string | null
          username?: string | null
          usuario?: string | null
        }
        Relationships: []
      }
      operadores_pdv: {
        Row: {
          active: boolean | null
          ativo: boolean | null
          created_at: string | null
          id: string
          login: string | null
          name: string | null
          nome: string | null
          organization_id: string | null
          password: string | null
          pin: string | null
          role: string | null
          senha: string | null
          store_id: string | null
          username: string | null
          usuario: string | null
        }
        Insert: {
          active?: boolean | null
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          login?: string | null
          name?: string | null
          nome?: string | null
          organization_id?: string | null
          password?: string | null
          pin?: string | null
          role?: string | null
          senha?: string | null
          store_id?: string | null
          username?: string | null
          usuario?: string | null
        }
        Update: {
          active?: boolean | null
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          login?: string | null
          name?: string | null
          nome?: string | null
          organization_id?: string | null
          password?: string | null
          pin?: string | null
          role?: string | null
          senha?: string | null
          store_id?: string | null
          username?: string | null
          usuario?: string | null
        }
        Relationships: []
      }
      operators: {
        Row: {
          active: boolean | null
          ativo: boolean | null
          created_at: string | null
          email: string | null
          id: string
          login: string | null
          name: string | null
          nome: string | null
          organization_id: string | null
          password: string | null
          pin: string | null
          profile_id: string | null
          role: string | null
          senha: string | null
          store_id: string | null
          user_id: string | null
          username: string | null
          usuario: string | null
        }
        Insert: {
          active?: boolean | null
          ativo?: boolean | null
          created_at?: string | null
          email?: string | null
          id?: string
          login?: string | null
          name?: string | null
          nome?: string | null
          organization_id?: string | null
          password?: string | null
          pin?: string | null
          profile_id?: string | null
          role?: string | null
          senha?: string | null
          store_id?: string | null
          user_id?: string | null
          username?: string | null
          usuario?: string | null
        }
        Update: {
          active?: boolean | null
          ativo?: boolean | null
          created_at?: string | null
          email?: string | null
          id?: string
          login?: string | null
          name?: string | null
          nome?: string | null
          organization_id?: string | null
          password?: string | null
          pin?: string | null
          profile_id?: string | null
          role?: string | null
          senha?: string | null
          store_id?: string | null
          user_id?: string | null
          username?: string | null
          usuario?: string | null
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
        Relationships: [
          {
            foreignKeyName: "order_cancellations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_cancellations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_financeiro_detalhado"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_cancellations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_number_counters: {
        Row: {
          last_number: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          last_number?: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          last_number?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_number_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          bairro_nome: string
          client_request_id: string | null
          cpf: string | null
          created_at: string
          customer_cpf: string | null
          customer_document: string | null
          customer_name: string
          customer_phone: string
          data_reembolso: string | null
          delivery_address: string | null
          delivery_code: string | null
          delivery_recipient: string | null
          delivery_reference: string | null
          entregador_id: string | null
          forma_pagamento: string | null
          id: string
          ingredient_stock_committed_at: string | null
          ingredient_stock_restocked_at: string | null
          items: Json
          kiosk_device_id: string | null
          loyalty_delivery_fee: number | null
          loyalty_discount: number | null
          loyalty_eligible_amount: number | null
          loyalty_subtotal: number | null
          metodo_pagamento: string | null
          nfe_numero: string | null
          nfe_status: string | null
          nfe_url: string | null
          order_number: string
          order_type: string
          organization_id: string | null
          payment_confirmed_at: string | null
          payment_method: string | null
          payment_status: string | null
          print_attempts: number
          print_claimed_at: string | null
          print_error: string
          print_status: string
          printed_at: string | null
          scheduled_for: string | null
          status: string
          status_reembolso: string
          stock_committed_at: string | null
          stock_restocked_at: string | null
          table_id: string | null
          table_label: string
          table_session_id: string | null
          total: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bairro_nome?: string
          client_request_id?: string | null
          cpf?: string | null
          created_at?: string
          customer_cpf?: string | null
          customer_document?: string | null
          customer_name: string
          customer_phone?: string
          data_reembolso?: string | null
          delivery_address?: string | null
          delivery_code?: string | null
          delivery_recipient?: string | null
          delivery_reference?: string | null
          entregador_id?: string | null
          forma_pagamento?: string | null
          id?: string
          ingredient_stock_committed_at?: string | null
          ingredient_stock_restocked_at?: string | null
          items?: Json
          kiosk_device_id?: string | null
          loyalty_delivery_fee?: number | null
          loyalty_discount?: number | null
          loyalty_eligible_amount?: number | null
          loyalty_subtotal?: number | null
          metodo_pagamento?: string | null
          nfe_numero?: string | null
          nfe_status?: string | null
          nfe_url?: string | null
          order_number: string
          order_type?: string
          organization_id?: string | null
          payment_confirmed_at?: string | null
          payment_method?: string | null
          payment_status?: string | null
          print_attempts?: number
          print_claimed_at?: string | null
          print_error?: string
          print_status?: string
          printed_at?: string | null
          scheduled_for?: string | null
          status?: string
          status_reembolso?: string
          stock_committed_at?: string | null
          stock_restocked_at?: string | null
          table_id?: string | null
          table_label?: string
          table_session_id?: string | null
          total?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bairro_nome?: string
          client_request_id?: string | null
          cpf?: string | null
          created_at?: string
          customer_cpf?: string | null
          customer_document?: string | null
          customer_name?: string
          customer_phone?: string
          data_reembolso?: string | null
          delivery_address?: string | null
          delivery_code?: string | null
          delivery_recipient?: string | null
          delivery_reference?: string | null
          entregador_id?: string | null
          forma_pagamento?: string | null
          id?: string
          ingredient_stock_committed_at?: string | null
          ingredient_stock_restocked_at?: string | null
          items?: Json
          kiosk_device_id?: string | null
          loyalty_delivery_fee?: number | null
          loyalty_discount?: number | null
          loyalty_eligible_amount?: number | null
          loyalty_subtotal?: number | null
          metodo_pagamento?: string | null
          nfe_numero?: string | null
          nfe_status?: string | null
          nfe_url?: string | null
          order_number?: string
          order_type?: string
          organization_id?: string | null
          payment_confirmed_at?: string | null
          payment_method?: string | null
          payment_status?: string | null
          print_attempts?: number
          print_claimed_at?: string | null
          print_error?: string
          print_status?: string
          printed_at?: string | null
          scheduled_for?: string | null
          status?: string
          status_reembolso?: string
          stock_committed_at?: string | null
          stock_restocked_at?: string | null
          table_id?: string | null
          table_label?: string
          table_session_id?: string | null
          total?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_entregador_id_fkey"
            columns: ["entregador_id"]
            isOneToOne: false
            referencedRelation: "entregadores"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          ativo: boolean
          bloqueado: boolean
          categoria: string
          cep: string | null
          cidade: string | null
          cnpj: string | null
          created_at: string
          endereco: string | null
          estado: string | null
          id: string
          instagram: string | null
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          master_id: string | null
          metadata: Json
          mp_next_charge_at: string | null
          mp_subscription_amount: number | null
          mp_subscription_id: string | null
          name: string
          owner_id: string | null
          plan_id: string | null
          razao_social: string | null
          slug: string
          status: string | null
          status_assinatura: string | null
          telefone: string | null
          updated_at: string
          vencimento_at: string | null
          whatsapp: string | null
        }
        Insert: {
          ativo?: boolean
          bloqueado?: boolean
          categoria?: string
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          created_at?: string
          endereco?: string | null
          estado?: string | null
          id?: string
          instagram?: string | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          master_id?: string | null
          metadata?: Json
          mp_next_charge_at?: string | null
          mp_subscription_amount?: number | null
          mp_subscription_id?: string | null
          name: string
          owner_id?: string | null
          plan_id?: string | null
          razao_social?: string | null
          slug: string
          status?: string | null
          status_assinatura?: string | null
          telefone?: string | null
          updated_at?: string
          vencimento_at?: string | null
          whatsapp?: string | null
        }
        Update: {
          ativo?: boolean
          bloqueado?: boolean
          categoria?: string
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          created_at?: string
          endereco?: string | null
          estado?: string | null
          id?: string
          instagram?: string | null
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          master_id?: string | null
          metadata?: Json
          mp_next_charge_at?: string | null
          mp_subscription_amount?: number | null
          mp_subscription_id?: string | null
          name?: string
          owner_id?: string | null
          plan_id?: string | null
          razao_social?: string | null
          slug?: string
          status?: string | null
          status_assinatura?: string | null
          telefone?: string | null
          updated_at?: string
          vencimento_at?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      papeis_usuario: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "papeis_usuario_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
            foreignKeyName: "parceria_cupons_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parceria_cupons_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "v_financeiro_detalhado"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "parceria_cupons_org_origem_fkey"
            columns: ["org_origem"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parceria_cupons_org_parceira_fkey"
            columns: ["org_parceira"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
        Relationships: [
          {
            foreignKeyName: "parcerias_org_origem_fkey"
            columns: ["org_origem"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcerias_org_parceira_fkey"
            columns: ["org_parceira"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pdv_pix_intents: {
        Row: {
          amount: number
          caixa_id: string
          created_at: string
          cupom_code: string
          expires_at: string
          id: string
          items: Json
          mp_payment_id: string | null
          mp_status_detail: string | null
          operador_id: string
          order_id: string | null
          organization_id: string
          paid_at: string | null
          payment_status: string | null
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          caixa_id: string
          created_at?: string
          cupom_code?: string
          expires_at?: string
          id?: string
          items: Json
          mp_payment_id?: string | null
          mp_status_detail?: string | null
          operador_id: string
          order_id?: string | null
          organization_id: string
          paid_at?: string | null
          payment_status?: string | null
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          caixa_id?: string
          created_at?: string
          cupom_code?: string
          expires_at?: string
          id?: string
          items?: Json
          mp_payment_id?: string | null
          mp_status_detail?: string | null
          operador_id?: string
          order_id?: string | null
          organization_id?: string
          paid_at?: string | null
          payment_status?: string | null
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdv_pix_intents_caixa_id_fkey"
            columns: ["caixa_id"]
            isOneToOne: false
            referencedRelation: "caixas_pdv"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_pix_intents_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "operadores_pdv"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_pix_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_pix_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_financeiro_detalhado"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "pdv_pix_intents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_pix_intents_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "pdv_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      pdv_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          last_seen_at: string
          operador_id: string
          organization_id: string
          revoked_at: string | null
          store_id: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          last_seen_at?: string
          operador_id: string
          organization_id: string
          revoked_at?: string | null
          store_id?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          last_seen_at?: string
          operador_id?: string
          organization_id?: string
          revoked_at?: string | null
          store_id?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdv_sessions_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "operadores_pdv"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdv_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          bairro: string | null
          cep: string | null
          cliente_cep: string | null
          cliente_endereco: string | null
          cliente_lat: number | null
          cliente_lng: number | null
          cliente_nome: string | null
          cliente_telefone: string | null
          codigo_entrega: string | null
          cpf: string | null
          created_at: string
          customer_cpf: string | null
          customer_document: string | null
          desconto: number
          endereco_entrega: string | null
          entregador_id: string | null
          forma_pagamento: string | null
          id: string
          itens: Json
          metadata: Json
          metodo_pagamento: string | null
          nome_cliente: string | null
          numero_pedido: string
          observacoes: string | null
          organization_id: string
          payment_method: string | null
          print_attempts: number
          print_error: string | null
          print_status: string
          printed_at: string | null
          status: string
          status_reembolso: string | null
          subtotal: number
          taxa_entrega: number
          telefone_cliente: string | null
          tipo_entrega: string | null
          tipo_pedido: string
          total: number
          troco_para: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cliente_cep?: string | null
          cliente_endereco?: string | null
          cliente_lat?: number | null
          cliente_lng?: number | null
          cliente_nome?: string | null
          cliente_telefone?: string | null
          codigo_entrega?: string | null
          cpf?: string | null
          created_at?: string
          customer_cpf?: string | null
          customer_document?: string | null
          desconto?: number
          endereco_entrega?: string | null
          entregador_id?: string | null
          forma_pagamento?: string | null
          id?: string
          itens?: Json
          metadata?: Json
          metodo_pagamento?: string | null
          nome_cliente?: string | null
          numero_pedido: string
          observacoes?: string | null
          organization_id: string
          payment_method?: string | null
          print_attempts?: number
          print_error?: string | null
          print_status?: string
          printed_at?: string | null
          status?: string
          status_reembolso?: string | null
          subtotal?: number
          taxa_entrega?: number
          telefone_cliente?: string | null
          tipo_entrega?: string | null
          tipo_pedido?: string
          total?: number
          troco_para?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cliente_cep?: string | null
          cliente_endereco?: string | null
          cliente_lat?: number | null
          cliente_lng?: number | null
          cliente_nome?: string | null
          cliente_telefone?: string | null
          codigo_entrega?: string | null
          cpf?: string | null
          created_at?: string
          customer_cpf?: string | null
          customer_document?: string | null
          desconto?: number
          endereco_entrega?: string | null
          entregador_id?: string | null
          forma_pagamento?: string | null
          id?: string
          itens?: Json
          metadata?: Json
          metodo_pagamento?: string | null
          nome_cliente?: string | null
          numero_pedido?: string
          observacoes?: string | null
          organization_id?: string
          payment_method?: string | null
          print_attempts?: number
          print_error?: string | null
          print_status?: string
          printed_at?: string | null
          status?: string
          status_reembolso?: string | null
          subtotal?: number
          taxa_entrega?: number
          telefone_cliente?: string | null
          tipo_entrega?: string | null
          tipo_pedido?: string
          total?: number
          troco_para?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_entregador_id_fkey"
            columns: ["entregador_id"]
            isOneToOne: false
            referencedRelation: "entregadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_carimbados: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          pedido_id: string
          telefone_cliente: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          pedido_id: string
          telefone_cliente: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          pedido_id?: string
          telefone_cliente?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_carimbados_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_carimbados_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_carimbados_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "v_financeiro_detalhado"
            referencedColumns: ["order_id"]
          },
        ]
      }
      perfis: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          id: string
          nome_exibicao: string | null
          organization_id: string | null
          origem_assinatura_empresa_id: string | null
          telefone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome_exibicao?: string | null
          organization_id?: string | null
          origem_assinatura_empresa_id?: string | null
          telefone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome_exibicao?: string | null
          organization_id?: string | null
          origem_assinatura_empresa_id?: string | null
          telefone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "perfis_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_features: {
        Row: {
          enabled: boolean | null
          feature_id: string
          plan_id: string
        }
        Insert: {
          enabled?: boolean | null
          feature_id: string
          plan_id: string
        }
        Update: {
          enabled?: boolean | null
          feature_id?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_features_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_recursos: {
        Row: {
          created_at: string
          id: string
          incluso: boolean | null
          plano_id: string | null
          recurso: string
        }
        Insert: {
          created_at?: string
          id?: string
          incluso?: boolean | null
          plano_id?: string | null
          recurso: string
        }
        Update: {
          created_at?: string
          id?: string
          incluso?: boolean | null
          plano_id?: string | null
          recurso?: string
        }
        Relationships: [
          {
            foreignKeyName: "plano_recursos_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
        ]
      }
      planos: {
        Row: {
          ativo: boolean | null
          beneficios: Json | null
          created_at: string
          id: string
          nome: string | null
          valor: number | null
        }
        Insert: {
          ativo?: boolean | null
          beneficios?: Json | null
          created_at?: string
          id?: string
          nome?: string | null
          valor?: number | null
        }
        Update: {
          ativo?: boolean | null
          beneficios?: Json | null
          created_at?: string
          id?: string
          nome?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      plans: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          name: string
          price: number | null
          sort_order: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          name: string
          price?: number | null
          sort_order?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          name?: string
          price?: number | null
          sort_order?: number | null
        }
        Relationships: []
      }
      product_reviews: {
        Row: {
          comment: string
          created_at: string
          id: string
          order_id: string
          organization_id: string
          product_id: string
          rating: number
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string
          created_at?: string
          id?: string
          order_id: string
          organization_id: string
          product_id: string
          rating: number
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string
          created_at?: string
          id?: string
          order_id?: string
          organization_id?: string
          product_id?: string
          rating?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "v_financeiro_detalhado"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "product_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          alerta_vencimento: boolean | null
          available: boolean | null
          category: string
          codigo_barras: string | null
          cost_price: number | null
          created_at: string
          data_vencimento: string | null
          description: string
          extras: Json
          id: string
          image: string
          ingredient_stock_blocked: boolean
          ingredients: Json
          is_combo: boolean | null
          lote: string | null
          low_stock_threshold: number
          manage_stock: boolean
          markup_percent: number | null
          name: string
          organization_id: string | null
          price: number
          removable_ingredients: Json
          sold_by_weight: boolean
          stock_quantity: number
          updated_at: string
        }
        Insert: {
          alerta_vencimento?: boolean | null
          available?: boolean | null
          category?: string
          codigo_barras?: string | null
          cost_price?: number | null
          created_at?: string
          data_vencimento?: string | null
          description?: string
          extras?: Json
          id?: string
          image?: string
          ingredient_stock_blocked?: boolean
          ingredients?: Json
          is_combo?: boolean | null
          lote?: string | null
          low_stock_threshold?: number
          manage_stock?: boolean
          markup_percent?: number | null
          name: string
          organization_id?: string | null
          price?: number
          removable_ingredients?: Json
          sold_by_weight?: boolean
          stock_quantity?: number
          updated_at?: string
        }
        Update: {
          alerta_vencimento?: boolean | null
          available?: boolean | null
          category?: string
          codigo_barras?: string | null
          cost_price?: number | null
          created_at?: string
          data_vencimento?: string | null
          description?: string
          extras?: Json
          id?: string
          image?: string
          ingredient_stock_blocked?: boolean
          ingredients?: Json
          is_combo?: boolean | null
          lote?: string | null
          low_stock_threshold?: number
          manage_stock?: boolean
          markup_percent?: number | null
          name?: string
          organization_id?: string | null
          price?: number
          removable_ingredients?: Json
          sold_by_weight?: boolean
          stock_quantity?: number
          updated_at?: string
        }
        Relationships: []
      }
      produtos: {
        Row: {
          categoria_id: string | null
          codigo_barras: string | null
          created_at: string
          descricao: string | null
          disponivel: boolean
          gerenciar_estoque: boolean
          id: string
          imagem_url: string | null
          metadata: Json
          nome: string
          ordem: number
          organization_id: string
          preco: number
          preco_promocional: number | null
          quantidade_estoque: number
          sku: string | null
          updated_at: string
          validade: string | null
        }
        Insert: {
          categoria_id?: string | null
          codigo_barras?: string | null
          created_at?: string
          descricao?: string | null
          disponivel?: boolean
          gerenciar_estoque?: boolean
          id?: string
          imagem_url?: string | null
          metadata?: Json
          nome: string
          ordem?: number
          organization_id: string
          preco?: number
          preco_promocional?: number | null
          quantidade_estoque?: number
          sku?: string | null
          updated_at?: string
          validade?: string | null
        }
        Update: {
          categoria_id?: string | null
          codigo_barras?: string | null
          created_at?: string
          descricao?: string | null
          disponivel?: boolean
          gerenciar_estoque?: boolean
          id?: string
          imagem_url?: string | null
          metadata?: Json
          nome?: string
          ordem?: number
          organization_id?: string
          preco?: number
          preco_promocional?: number | null
          quantidade_estoque?: number
          sku?: string | null
          updated_at?: string
          validade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_organization_id_fkey"
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
          email: string | null
          id: string
          organization_id: string | null
          origem_assinatura_empresa_id: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          organization_id?: string | null
          origem_assinatura_empresa_id?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          organization_id?: string | null
          origem_assinatura_empresa_id?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_origem_assinatura_empresa_id_fkey"
            columns: ["origem_assinatura_empresa_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      progresso_fidelidade: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          points_balance: number
          points_earned_total: number
          points_spent_total: number
          premios_resgatados: number
          quantidade_carimbos: number
          telefone_cliente: string
          ultimo_pedido_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          points_balance?: number
          points_earned_total?: number
          points_spent_total?: number
          premios_resgatados?: number
          quantidade_carimbos?: number
          telefone_cliente: string
          ultimo_pedido_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          points_balance?: number
          points_earned_total?: number
          points_spent_total?: number
          premios_resgatados?: number
          quantidade_carimbos?: number
          telefone_cliente?: string
          ultimo_pedido_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "progresso_fidelidade_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progresso_fidelidade_ultimo_pedido_id_fkey"
            columns: ["ultimo_pedido_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progresso_fidelidade_ultimo_pedido_id_fkey"
            columns: ["ultimo_pedido_id"]
            isOneToOne: false
            referencedRelation: "v_financeiro_detalhado"
            referencedColumns: ["order_id"]
          },
        ]
      }
      receitas: {
        Row: {
          created_at: string | null
          id: string
          ingredient_id: string | null
          ingrediente_id: string | null
          organization_id: string | null
          product_id: string | null
          produto_id: string | null
          quantidade: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          ingredient_id?: string | null
          ingrediente_id?: string | null
          organization_id?: string | null
          product_id?: string | null
          produto_id?: string | null
          quantidade?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          ingredient_id?: string | null
          ingrediente_id?: string | null
          organization_id?: string | null
          product_id?: string | null
          produto_id?: string | null
          quantidade?: number | null
        }
        Relationships: []
      }
      recursos: {
        Row: {
          categoria: string | null
          chave: string
          created_at: string
          descricao: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          categoria?: string | null
          chave: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          categoria?: string | null
          chave?: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
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
          points_spent: number
          premio_descricao: string
          premio_imagem: string | null
          premio_texto: string
          reward_id: string | null
          status: string
          telefone_cliente: string
          used_at: string | null
          used_by_user: string | null
          user_id: string | null
        }
        Insert: {
          codigo_resgate: string
          created_at?: string
          id?: string
          organization_id: string
          points_spent?: number
          premio_descricao?: string
          premio_imagem?: string | null
          premio_texto?: string
          reward_id?: string | null
          status?: string
          telefone_cliente: string
          used_at?: string | null
          used_by_user?: string | null
          user_id?: string | null
        }
        Update: {
          codigo_resgate?: string
          created_at?: string
          id?: string
          organization_id?: string
          points_spent?: number
          premio_descricao?: string
          premio_imagem?: string | null
          premio_texto?: string
          reward_id?: string | null
          status?: string
          telefone_cliente?: string
          used_at?: string | null
          used_by_user?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resgates_fidelidade_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resgates_fidelidade_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "loyalty_rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      senhas: {
        Row: {
          balcao: string | null
          called_by: string | null
          created_at: string
          id: string
          numero: string | null
          numero_senha: string | null
          organization_id: string | null
          prefixo: string | null
          prioritaria: boolean | null
          senha: string | null
          status: string | null
          tipo: string | null
        }
        Insert: {
          balcao?: string | null
          called_by?: string | null
          created_at?: string
          id?: string
          numero?: string | null
          numero_senha?: string | null
          organization_id?: string | null
          prefixo?: string | null
          prioritaria?: boolean | null
          senha?: string | null
          status?: string | null
          tipo?: string | null
        }
        Update: {
          balcao?: string | null
          called_by?: string | null
          created_at?: string
          id?: string
          numero?: string | null
          numero_senha?: string | null
          organization_id?: string | null
          prefixo?: string | null
          prioritaria?: boolean | null
          senha?: string | null
          status?: string | null
          tipo?: string | null
        }
        Relationships: []
      }
      senhas_chamadas: {
        Row: {
          balcao: string | null
          called_at: string | null
          called_by: string | null
          created_at: string
          id: string
          numero: string | null
          numero_senha: string | null
          organization_id: string | null
          prefixo: string | null
          prioritaria: boolean | null
          senha: string | null
          status: string | null
          tipo: string | null
        }
        Insert: {
          balcao?: string | null
          called_at?: string | null
          called_by?: string | null
          created_at?: string
          id?: string
          numero?: string | null
          numero_senha?: string | null
          organization_id?: string | null
          prefixo?: string | null
          prioritaria?: boolean | null
          senha?: string | null
          status?: string | null
          tipo?: string | null
        }
        Update: {
          balcao?: string | null
          called_at?: string | null
          called_by?: string | null
          created_at?: string
          id?: string
          numero?: string | null
          numero_senha?: string | null
          organization_id?: string | null
          prefixo?: string | null
          prioritaria?: boolean | null
          senha?: string | null
          status?: string | null
          tipo?: string | null
        }
        Relationships: []
      }
      senhas_counters: {
        Row: {
          last_number: number
          organization_id: string
          prefixo: string
          updated_at: string
        }
        Insert: {
          last_number?: number
          organization_id: string
          prefixo: string
          updated_at?: string
        }
        Update: {
          last_number?: number
          organization_id?: string
          prefixo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "senhas_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          address: string | null
          allow_scheduling: boolean | null
          balanca_ativa: boolean | null
          balanca_baud_rate: number | null
          balanca_modelo: string | null
          balanca_porta: string | null
          banners: Json
          business_hours: Json | null
          categories: Json
          category_icons: Json
          cep_lat: number | null
          cep_lng: number | null
          cep_loja: string | null
          cep_lon: number | null
          closed_message: string | null
          combo: Json
          cover_image: string | null
          created_at: string
          delivery_assignment_mode: string
          delivery_enabled: boolean | null
          delivery_horario_fim: string | null
          delivery_horario_inicio: string | null
          delivery_mode: string | null
          delivery_pedido_minimo: number | null
          delivery_raio_km: number | null
          delivery_taxa_base: number | null
          delivery_taxa_por_km: number | null
          delivery_tempo_base_min: number | null
          delivery_tempo_estimado: number | null
          delivery_tempo_por_km_min: number | null
          emergency_closed: boolean | null
          endereco: string | null
          estoque_webhook_url: string | null
          id: string
          imagem_capa: string | null
          impressora_ativa: boolean | null
          impressora_modelo: string | null
          impressora_porta: string | null
          instagram_url: string
          is_open: boolean | null
          logo_url: string | null
          mp_terminal_id: string
          nome_loja: string | null
          opening_hours: Json | null
          organization_id: string | null
          pay_card_online_enabled: boolean
          pay_card_terminal_enabled: boolean
          pay_cash_enabled: boolean
          pay_pix_enabled: boolean
          phone: string | null
          pix_chave: string | null
          pix_key_manual: string
          ruptura_webhook: string | null
          scheduling_enabled: boolean | null
          store_name: string
          taxa_delivery: number | null
          taxa_vision_percent: number
          telefone: string | null
          updated_at: string
          webhook_estoque: string | null
          whatsapp_number: string
        }
        Insert: {
          address?: string | null
          allow_scheduling?: boolean | null
          balanca_ativa?: boolean | null
          balanca_baud_rate?: number | null
          balanca_modelo?: string | null
          balanca_porta?: string | null
          banners?: Json
          business_hours?: Json | null
          categories?: Json
          category_icons?: Json
          cep_lat?: number | null
          cep_lng?: number | null
          cep_loja?: string | null
          cep_lon?: number | null
          closed_message?: string | null
          combo?: Json
          cover_image?: string | null
          created_at?: string
          delivery_assignment_mode?: string
          delivery_enabled?: boolean | null
          delivery_horario_fim?: string | null
          delivery_horario_inicio?: string | null
          delivery_mode?: string | null
          delivery_pedido_minimo?: number | null
          delivery_raio_km?: number | null
          delivery_taxa_base?: number | null
          delivery_taxa_por_km?: number | null
          delivery_tempo_base_min?: number | null
          delivery_tempo_estimado?: number | null
          delivery_tempo_por_km_min?: number | null
          emergency_closed?: boolean | null
          endereco?: string | null
          estoque_webhook_url?: string | null
          id?: string
          imagem_capa?: string | null
          impressora_ativa?: boolean | null
          impressora_modelo?: string | null
          impressora_porta?: string | null
          instagram_url?: string
          is_open?: boolean | null
          logo_url?: string | null
          mp_terminal_id?: string
          nome_loja?: string | null
          opening_hours?: Json | null
          organization_id?: string | null
          pay_card_online_enabled?: boolean
          pay_card_terminal_enabled?: boolean
          pay_cash_enabled?: boolean
          pay_pix_enabled?: boolean
          phone?: string | null
          pix_chave?: string | null
          pix_key_manual?: string
          ruptura_webhook?: string | null
          scheduling_enabled?: boolean | null
          store_name?: string
          taxa_delivery?: number | null
          taxa_vision_percent?: number
          telefone?: string | null
          updated_at?: string
          webhook_estoque?: string | null
          whatsapp_number?: string
        }
        Update: {
          address?: string | null
          allow_scheduling?: boolean | null
          balanca_ativa?: boolean | null
          balanca_baud_rate?: number | null
          balanca_modelo?: string | null
          balanca_porta?: string | null
          banners?: Json
          business_hours?: Json | null
          categories?: Json
          category_icons?: Json
          cep_lat?: number | null
          cep_lng?: number | null
          cep_loja?: string | null
          cep_lon?: number | null
          closed_message?: string | null
          combo?: Json
          cover_image?: string | null
          created_at?: string
          delivery_assignment_mode?: string
          delivery_enabled?: boolean | null
          delivery_horario_fim?: string | null
          delivery_horario_inicio?: string | null
          delivery_mode?: string | null
          delivery_pedido_minimo?: number | null
          delivery_raio_km?: number | null
          delivery_taxa_base?: number | null
          delivery_taxa_por_km?: number | null
          delivery_tempo_base_min?: number | null
          delivery_tempo_estimado?: number | null
          delivery_tempo_por_km_min?: number | null
          emergency_closed?: boolean | null
          endereco?: string | null
          estoque_webhook_url?: string | null
          id?: string
          imagem_capa?: string | null
          impressora_ativa?: boolean | null
          impressora_modelo?: string | null
          impressora_porta?: string | null
          instagram_url?: string
          is_open?: boolean | null
          logo_url?: string | null
          mp_terminal_id?: string
          nome_loja?: string | null
          opening_hours?: Json | null
          organization_id?: string | null
          pay_card_online_enabled?: boolean
          pay_card_terminal_enabled?: boolean
          pay_cash_enabled?: boolean
          pay_pix_enabled?: boolean
          phone?: string | null
          pix_chave?: string | null
          pix_key_manual?: string
          ruptura_webhook?: string | null
          scheduling_enabled?: boolean | null
          store_name?: string
          taxa_delivery?: number | null
          taxa_vision_percent?: number
          telefone?: string | null
          updated_at?: string
          webhook_estoque?: string | null
          whatsapp_number?: string
        }
        Relationships: []
      }
      store_subscriptions: {
        Row: {
          features: string[] | null
          id: string
          organization_id: string | null
          plan_name: string | null
          price: number | null
          status: string | null
        }
        Insert: {
          features?: string[] | null
          id?: string
          organization_id?: string | null
          plan_name?: string | null
          price?: number | null
          status?: string | null
        }
        Update: {
          features?: string[] | null
          id?: string
          organization_id?: string | null
          plan_name?: string | null
          price?: number | null
          status?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          created_at: string | null
          id: string
          updated_at: string
          valor_plano_padrao: number
          whatsapp_suporte: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          updated_at?: string
          valor_plano_padrao?: number
          whatsapp_suporte?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          updated_at?: string
          valor_plano_padrao?: number
          whatsapp_suporte?: string
        }
        Relationships: []
      }
      taxas_entrega: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          id: string
          nome_bairro: string
          organization_id: string | null
          taxa_entrega: number | null
          tempo_estimado: number | null
          valor_taxa: number | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          nome_bairro: string
          organization_id?: string | null
          taxa_entrega?: number | null
          tempo_estimado?: number | null
          valor_taxa?: number | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          nome_bairro?: string
          organization_id?: string | null
          taxa_entrega?: number | null
          tempo_estimado?: number | null
          valor_taxa?: number | null
        }
        Relationships: []
      }
      temas_loja: {
        Row: {
          banner_url: string | null
          created_at: string
          extras: Json
          id: string
          logo_url: string | null
          organization_id: string
          tema: string
          updated_at: string
        }
        Insert: {
          banner_url?: string | null
          created_at?: string
          extras?: Json
          id?: string
          logo_url?: string | null
          organization_id: string
          tema?: string
          updated_at?: string
        }
        Update: {
          banner_url?: string | null
          created_at?: string
          extras?: Json
          id?: string
          logo_url?: string | null
          organization_id?: string
          tema?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "temas_loja_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      teste_conexao: {
        Row: {
          created_at: string | null
          id: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          status?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
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
        Relationships: [
          {
            foreignKeyName: "vision_prime_assinaturas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vision_prime_config: {
        Row: {
          active: boolean | null
          ativo: boolean | null
          desconto: number | null
          desconto_percentual: number | null
          fixed_discount: number | null
          free_shipping_threshold: number | null
          frete_gratis_a_partir: number | null
          frete_gratis_minimo: number | null
          id: string
          mensalidade: number | null
          monthly_fee: number | null
          organization_id: string | null
          preco: number | null
          valor: number | null
          valor_mensalidade: number | null
        }
        Insert: {
          active?: boolean | null
          ativo?: boolean | null
          desconto?: number | null
          desconto_percentual?: number | null
          fixed_discount?: number | null
          free_shipping_threshold?: number | null
          frete_gratis_a_partir?: number | null
          frete_gratis_minimo?: number | null
          id?: string
          mensalidade?: number | null
          monthly_fee?: number | null
          organization_id?: string | null
          preco?: number | null
          valor?: number | null
          valor_mensalidade?: number | null
        }
        Update: {
          active?: boolean | null
          ativo?: boolean | null
          desconto?: number | null
          desconto_percentual?: number | null
          fixed_discount?: number | null
          free_shipping_threshold?: number | null
          frete_gratis_a_partir?: number | null
          frete_gratis_minimo?: number | null
          id?: string
          mensalidade?: number | null
          monthly_fee?: number | null
          organization_id?: string | null
          preco?: number | null
          valor?: number | null
          valor_mensalidade?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      v_financeiro_detalhado: {
        Row: {
          created_at: string | null
          customer_name: string | null
          order_id: string | null
          order_number: string | null
          organization_id: string | null
          payment_method: string | null
          status: string | null
          taxa_gateway_valor: number | null
          taxa_vision_valor: number | null
          valor_bruto: number | null
          valor_liquido_final: number | null
        }
        Relationships: []
      }
      vw_operadores: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          id: string | null
          nome: string | null
          organization_id: string | null
          usuario: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string | null
          nome?: string | null
          organization_id?: string | null
          usuario?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string | null
          nome?: string | null
          organization_id?: string | null
          usuario?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      ai_suggestion_stats: {
        Args: { _org: string }
        Returns: {
          category: string
          conversion_rate: number
          total_conversions: number
          total_dismissed: number
          total_sent: number
        }[]
      }
      assign_entregador: {
        Args: { _entregador_id: string; _order_id: string }
        Returns: Json
      }
      cancelar_pedido: {
        Args: { _motivo?: string; _order_id: string }
        Returns: Json
      }
      chamar_proxima_senha: {
        Args: { _organization_id: string; _prefixo?: string; _tipo?: string }
        Returns: {
          called_at: string
          id: string
          numero: string
          tipo: string
        }[]
      }
      clube_vantagens_catalog: {
        Args: { _fallback_org?: string }
        Returns: Json
      }
      comarketing_global_map: {
        Args: never
        Returns: {
          discount_percent: number
          id: string
          min_order_value: number
          org_origem: string
          org_parceira: string
          origem_city: string
          origem_name: string
          parceira_city: string
          parceira_name: string
          status: string
        }[]
      }
      comarketing_panel_data: { Args: { _org: string }; Returns: Json }
      comarketing_update_identity: {
        Args: {
          _categoria: string
          _cidade: string
          _logo_url: string
          _org: string
        }
        Returns: Json
      }
      confirm_delivery_with_code_session: {
        Args: { _code: string; _order_id: string; _session_token: string }
        Returns: Json
      }
      confirm_order_payment: { Args: { _order_id: string }; Returns: Json }
      create_order_checkout: {
        Args: {
          _bairro_id?: string
          _bairro_nome?: string
          _coupon_code?: string
          _customer_cpf?: string
          _customer_name: string
          _customer_phone?: string
          _delivery_address?: string
          _delivery_fee?: number
          _delivery_recipient?: string
          _delivery_reference?: string
          _items?: Json
          _order_type?: string
          _organization_id: string
          _payment_method?: string
          _scheduled_for?: string
          _total?: number
        }
        Returns: {
          id: string
          order_number: string
        }[]
      }
      create_order_checkout_v2: {
        Args: {
          _bairro_id?: string
          _bairro_nome?: string
          _coupon_code?: string
          _customer_cpf?: string
          _customer_name: string
          _customer_phone?: string
          _delivery_address?: string
          _delivery_context?: Json
          _delivery_fee?: number
          _delivery_recipient?: string
          _delivery_reference?: string
          _items?: Json
          _order_type?: string
          _organization_id: string
          _payment_method?: string
          _scheduled_for?: string
          _total?: number
        }
        Returns: {
          id: string
          order_number: string
        }[]
      }
      create_order_checkout_v3: {
        Args: {
          _bairro_id?: string
          _bairro_nome?: string
          _coupon_code?: string
          _customer_cpf?: string
          _customer_name: string
          _customer_phone?: string
          _delivery_address?: string
          _delivery_context?: Json
          _delivery_fee?: number
          _delivery_recipient?: string
          _delivery_reference?: string
          _items?: Json
          _order_type?: string
          _organization_id: string
          _payment_method?: string
          _scheduled_for?: string
          _total?: number
        }
        Returns: {
          delivery_code: string
          id: string
          order_number: string
        }[]
      }
      create_order_checkout_v4: {
        Args: {
          _bairro_id?: string
          _bairro_nome?: string
          _client_request_id?: string
          _coupon_code?: string
          _customer_cpf?: string
          _customer_name: string
          _customer_phone?: string
          _delivery_address?: string
          _delivery_context?: Json
          _delivery_fee?: number
          _delivery_recipient?: string
          _delivery_reference?: string
          _items?: Json
          _order_type?: string
          _organization_id: string
          _payment_method?: string
          _scheduled_for?: string
          _table_token?: string
          _total?: number
        }
        Returns: {
          delivery_code: string
          id: string
          idempotent: boolean
          order_number: string
          table_label: string
          table_session_id: string
        }[]
      }
      eh_master_admin: { Args: { _uid: string }; Returns: boolean }
      entregador_available_orders_session: {
        Args: { _session_token: string }
        Returns: Json
      }
      entregador_claim_order_session: {
        Args: { _order_id: string; _session_token: string }
        Returns: Json
      }
      entregador_login: {
        Args: { _org_slug: string; _password: string; _username: string }
        Returns: Json
      }
      entregador_login_session: {
        Args: { _org_slug: string; _password: string; _username: string }
        Returns: Json
      }
      entregador_logout_session: {
        Args: { _session_token: string }
        Returns: Json
      }
      entregador_orders_session: {
        Args: { _session_token: string }
        Returns: Json
      }
      entregador_session_driver: {
        Args: { _token: string }
        Returns: {
          active: boolean | null
          ativo: boolean
          created_at: string
          id: string
          name: string | null
          nome: string | null
          organization_id: string
          password: string | null
          senha: string | null
          telefone: string | null
          ultima_lat: number | null
          ultima_lng: number | null
          ultima_localizacao_at: string | null
          ultima_localizacao_pedido_id: string | null
          updated_at: string
          username: string | null
          usuario: string | null
        }
        SetofOptions: {
          from: "*"
          to: "entregadores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      entregador_update_location_session: {
        Args: {
          _lat: number
          _lng: number
          _order_id?: string
          _session_token: string
        }
        Returns: Json
      }
      get_master_mp_token_internal: { Args: never; Returns: string }
      get_mp_access_token_internal: { Args: { _org: string }; Returns: string }
      get_mp_credentials_for_owner: { Args: { _org: string }; Returns: Json }
      grant_loyalty_stamp: { Args: { _order_id: string }; Returns: Json }
      has_master_mp_token: { Args: never; Returns: boolean }
      has_mp_access_token: { Args: { _org: string }; Returns: boolean }
      loyalty_admin_summary: {
        Args: { _organization_id: string }
        Returns: Json
      }
      loyalty_customer_state: {
        Args: { _organization_id: string }
        Returns: Json
      }
      loyalty_redeem_reward: {
        Args: { _organization_id: string; _reward_id: string }
        Returns: Json
      }
      next_order_number: { Args: { _organization_id: string }; Returns: string }
      onesignal_admin_config: { Args: never; Returns: Json }
      onesignal_public_config: { Args: never; Returns: Json }
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
      parceria_toggle: {
        Args: { _enabled: boolean; _parceria_id: string }
        Returns: Json
      }
      pdv_abrir_caixa_session: {
        Args: { _saldo_inicial?: number; _session_token: string }
        Returns: Json
      }
      pdv_abrir_caixa_v2: {
        Args: { _saldo_inicial: number; _session_token: string }
        Returns: Json
      }
      pdv_bind_pix_payment_internal: {
        Args: { _intent_id: string; _payment_id: string }
        Returns: Json
      }
      pdv_buscar_pedido_v2: {
        Args: { _query: string; _session_token: string }
        Returns: Json
      }
      pdv_caixa_resumo_v2: {
        Args: { _caixa_id: string; _session_token: string }
        Returns: Json
      }
      pdv_catalog_v2: { Args: { _session_token: string }; Returns: Json }
      pdv_claim_pix_intent_internal: {
        Args: { _intent_id: string; _session_token: string }
        Returns: Json
      }
      pdv_create_pix_intent_v2: {
        Args: {
          _caixa_id: string
          _cupom_code?: string
          _items: Json
          _session_token: string
        }
        Returns: Json
      }
      pdv_create_session: {
        Args: { _org_slug: string; _password: string; _username: string }
        Returns: Json
      }
      pdv_devolver_pedido_v2: {
        Args: {
          _caixa_id: string
          _items_devolvidos: Json
          _motivo: string
          _order_id: string
          _session_token: string
          _valor_devolucao: number
        }
        Returns: Json
      }
      pdv_fechar_caixa_session: {
        Args: { _caixa_id: string; _session_token: string }
        Returns: Json
      }
      pdv_fechar_caixa_v2: {
        Args: { _caixa_id: string; _session_token: string }
        Returns: Json
      }
      pdv_logout_v2: { Args: { _session_token: string }; Returns: boolean }
      pdv_operador_login: {
        Args: { _org_slug?: string; _password?: string; _username?: string }
        Returns: Json
      }
      pdv_pix_status_v2: {
        Args: { _intent_id: string; _session_token: string }
        Returns: Json
      }
      pdv_registrar_movimento_session: {
        Args: {
          _caixa_id: string
          _forma: string
          _motivo: string
          _session_token: string
          _tipo: string
          _valor: number
        }
        Returns: Json
      }
      pdv_registrar_movimento_v2: {
        Args: {
          _caixa_id: string
          _forma: string
          _motivo: string
          _session_token: string
          _tipo: string
          _valor: number
        }
        Returns: Json
      }
      pdv_registrar_venda_pix_v2: {
        Args: { _intent_id: string; _session_token: string }
        Returns: Json
      }
      pdv_registrar_venda_v2: {
        Args: {
          _caixa_id: string
          _cupom_code?: string
          _desconto?: number
          _forma: string
          _items: Json
          _session_token: string
          _total: number
        }
        Returns: Json
      }
      pdv_resume_session_v2: { Args: { _session_token: string }; Returns: Json }
      pdv_revoke_session: { Args: { _token: string }; Returns: boolean }
      pdv_session_context: { Args: { _token: string }; Returns: Json }
      pdv_set_order_customer_phone_v2: {
        Args: {
          _customer_phone: string
          _order_id: string
          _session_token: string
        }
        Returns: Json
      }
      pdv_update_pix_payment_internal: {
        Args: {
          _amount?: number
          _payment_id: string
          _status: string
          _status_detail?: string
        }
        Returns: Json
      }
      pdv_validar_cupom_v2: {
        Args: { _codigo: string; _session_token: string }
        Returns: Json
      }
      print_agent_ack: {
        Args: {
          _error?: string
          _order_id: string
          _success: boolean
          _token: string
        }
        Returns: Json
      }
      print_agent_authenticate: { Args: { _token: string }; Returns: Json }
      print_agent_claim_jobs: {
        Args: { _limit?: number; _token: string }
        Returns: Json
      }
      print_agent_rotate_token: { Args: { _org: string }; Returns: Json }
      product_review_eligible_order: {
        Args: { _product_id: string }
        Returns: string
      }
      quote_order_checkout: {
        Args: {
          _bairro_id?: string
          _coupon_code?: string
          _delivery_fee?: number
          _items?: Json
          _order_type?: string
          _organization_id: string
        }
        Returns: Json
      }
      quote_order_checkout_v2: {
        Args: {
          _bairro_id?: string
          _coupon_code?: string
          _delivery_context?: Json
          _delivery_fee?: number
          _items?: Json
          _order_type?: string
          _organization_id: string
        }
        Returns: Json
      }
      reabastecer_ingrediente: {
        Args: { _id: string; _quantidade: number }
        Returns: Json
      }
      redeem_loyalty_prize: { Args: { _resgate_id: string }; Returns: Json }
      reset_senha_counter: {
        Args: { _organization_id: string; _prefixo?: string }
        Returns: undefined
      }
      set_master_mp_token: { Args: { _token: string }; Returns: Json }
      set_mp_credentials: {
        Args: {
          _access_token: string
          _client_id: string
          _org: string
          _public_key: string
        }
        Returns: Json
      }
      set_onesignal_config: {
        Args: { _api_key?: string; _app_id: string }
        Returns: Json
      }
      set_system_whatsapp_suporte: {
        Args: { _whatsapp: string }
        Returns: Json
      }
      set_valor_plano_padrao: { Args: { _valor: number }; Returns: Json }
      submit_product_review: {
        Args: {
          _comment?: string
          _order_id: string
          _product_id: string
          _rating: number
        }
        Returns: Json
      }
      validar_cep_entrega: {
        Args: { _cep: string; _lat?: number; _lng?: number; _org: string }
        Returns: Json
      }
      validate_checkout_coupon: {
        Args: { _codigo: string; _organization_id: string; _subtotal?: number }
        Returns: Json
      }
      vision_prime_my_status: { Args: { _org: string }; Returns: Json }
      vision_prime_public_config: {
        Args: { _org: string }
        Returns: {
          ativo: boolean
          desconto_percentual: number
          frete_gratis_minimo: number
          valor_mensalidade: number
        }[]
      }
      vision_prime_subscribe: { Args: { _org: string }; Returns: Json }
      visionfood_admin_tables: { Args: { _org: string }; Returns: Json }
      visionfood_apply_loyalty_for_order: {
        Args: { _order_id: string }
        Returns: Json
      }
      visionfood_assert_checkout_item_weights: {
        Args: { _items: Json; _organization_id: string }
        Returns: undefined
      }
      visionfood_checkout_payment_config: {
        Args: { _org: string }
        Returns: Json
      }
      visionfood_claim_kiosk_enrollment: {
        Args: {
          _credential_hash: string
          _device_id: string
          _enrollment_token: string
        }
        Returns: Json
      }
      visionfood_close_table_session: {
        Args: { _session_id: string }
        Returns: Json
      }
      visionfood_coupon_rate_limit_check: {
        Args: { _org: string }
        Returns: undefined
      }
      visionfood_create_kiosk_enrollment: {
        Args: { _label: string; _org: string }
        Returns: Json
      }
      visionfood_create_kiosk_rotation: {
        Args: { _device_id: string; _org: string }
        Returns: Json
      }
      visionfood_delivery_history: {
        Args: { _limit?: number; _org: string }
        Returns: Json
      }
      visionfood_dispatch_orders: {
        Args: { _entregador_id: string; _order_ids: string[] }
        Returns: Json
      }
      visionfood_kiosk_device_heartbeat: {
        Args: { _credential: string; _device_id: string }
        Returns: Json
      }
      visionfood_kiosk_devices: { Args: { _org: string }; Returns: Json }
      visionfood_kiosk_tables: {
        Args: { _credential: string; _device_id: string }
        Returns: Json
      }
      visionfood_link_google_profile: {
        Args: { _organization_id: string }
        Returns: boolean
      }
      visionfood_my_orders: { Args: { _limit?: number }; Returns: Json }
      visionfood_onesignal_queue: {
        Args: { _contents: Json; _data?: Json; _headings: Json; _target: Json }
        Returns: number
      }
      visionfood_order_receipt: { Args: { _order_id: string }; Returns: Json }
      visionfood_profile_count: { Args: { _org: string }; Returns: number }
      visionfood_public_called_tickets: {
        Args: { _limit?: number; _org: string }
        Returns: Json
      }
      visionfood_public_catalog: { Args: { _org: string }; Returns: Json }
      visionfood_public_combo: { Args: { _org: string }; Returns: Json }
      visionfood_public_delivery_areas: {
        Args: { _org: string }
        Returns: Json
      }
      visionfood_public_loyalty_config: {
        Args: { _org: string }
        Returns: Json
      }
      visionfood_public_order_tracking: {
        Args: { _order_id: string }
        Returns: Json
      }
      visionfood_public_organization: {
        Args: { _org_id?: string; _slug?: string }
        Returns: Json
      }
      visionfood_public_product_reviews: {
        Args: { _limit?: number; _product_id: string }
        Returns: Json
      }
      visionfood_public_storefront_config: {
        Args: { _org: string }
        Returns: Json
      }
      visionfood_public_table_context: {
        Args: { _organization_id: string; _table_token: string }
        Returns: Json
      }
      visionfood_public_theme: { Args: { _org: string }; Returns: Json }
      visionfood_push_predictive_stock: {
        Args: {
          _days_remaining: number
          _ingredient_name: string
          _org: string
        }
        Returns: Json
      }
      visionfood_restock_cancelled_order: {
        Args: { _order_id: string }
        Returns: boolean
      }
      visionfood_restock_recipe_stock: {
        Args: { _order_id: string }
        Returns: boolean
      }
      visionfood_reverse_loyalty_for_order: {
        Args: { _order_id: string }
        Returns: Json
      }
      visionfood_revoke_kiosk_device: {
        Args: { _device_id: string; _org: string }
        Returns: Json
      }
      visionfood_rotate_table_token: {
        Args: { _org: string; _table_id: string }
        Returns: Json
      }
      visionfood_set_kiosk_device_active: {
        Args: { _active: boolean; _device_id: string; _org: string }
        Returns: Json
      }
      visionfood_sync_ingredient_state: {
        Args: {
          _ingredient_id: string
          _organization_id: string
          _source_product_id?: string
        }
        Returns: undefined
      }
      visionfood_sync_kiosk_order: {
        Args: {
          _client_request_id: string
          _credential: string
          _device_id: string
          _local_order_id: string
          _payload: Json
        }
        Returns: Json
      }
      visionfood_sync_product_recipe_availability: {
        Args: { _organization_id: string; _product_id: string }
        Returns: undefined
      }
      visionfood_update_order_status: {
        Args: {
          _expected_status: string
          _next_status: string
          _order_id: string
        }
        Returns: Json
      }
      visionfood_upsert_combo_product: {
        Args: {
          _description?: string
          _image?: string
          _name: string
          _org: string
          _price: number
        }
        Returns: Json
      }
      visionfood_upsert_table: {
        Args: { _label: string; _org: string; _table_id?: string }
        Returns: Json
      }
      visionfood_validate_item_weight: {
        Args: { _organization_id: string; _product_id: string; _weight: number }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "super_admin" | "dono" | "gerente" | "operador" | "entregador"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["super_admin", "dono", "gerente", "operador", "entregador"],
    },
  },
} as const
