export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  langgraph: {
    Tables: {
      checkpoint_blobs: {
        Row: {
          blob: string | null
          channel: string
          checkpoint_ns: string
          thread_id: string
          type: string
          version: string
        }
        Insert: {
          blob?: string | null
          channel: string
          checkpoint_ns?: string
          thread_id: string
          type: string
          version: string
        }
        Update: {
          blob?: string | null
          channel?: string
          checkpoint_ns?: string
          thread_id?: string
          type?: string
          version?: string
        }
        Relationships: []
      }
      checkpoint_migrations: {
        Row: {
          v: number
        }
        Insert: {
          v: number
        }
        Update: {
          v?: number
        }
        Relationships: []
      }
      checkpoint_writes: {
        Row: {
          blob: string
          channel: string
          checkpoint_id: string
          checkpoint_ns: string
          idx: number
          task_id: string
          thread_id: string
          type: string | null
        }
        Insert: {
          blob: string
          channel: string
          checkpoint_id: string
          checkpoint_ns?: string
          idx: number
          task_id: string
          thread_id: string
          type?: string | null
        }
        Update: {
          blob?: string
          channel?: string
          checkpoint_id?: string
          checkpoint_ns?: string
          idx?: number
          task_id?: string
          thread_id?: string
          type?: string | null
        }
        Relationships: []
      }
      checkpoints: {
        Row: {
          checkpoint: Json
          checkpoint_id: string
          checkpoint_ns: string
          metadata: Json
          parent_checkpoint_id: string | null
          thread_id: string
          type: string | null
        }
        Insert: {
          checkpoint: Json
          checkpoint_id: string
          checkpoint_ns?: string
          metadata?: Json
          parent_checkpoint_id?: string | null
          thread_id: string
          type?: string | null
        }
        Update: {
          checkpoint?: Json
          checkpoint_id?: string
          checkpoint_ns?: string
          metadata?: Json
          parent_checkpoint_id?: string | null
          thread_id?: string
          type?: string | null
        }
        Relationships: []
      }
      store: {
        Row: {
          created_at: string | null
          expires_at: string | null
          key: string
          namespace_path: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          key: string
          namespace_path: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          key?: string
          namespace_path?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      store_migrations: {
        Row: {
          v: number
        }
        Insert: {
          v: number
        }
        Update: {
          v?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          model: string | null
          session_id: string
          status: string
          thread_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          model?: string | null
          session_id: string
          status: string
          thread_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          model?: string | null
          session_id?: string
          status?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_objects: {
        Row: {
          bucket: string
          byte_size: number | null
          created_at: string
          created_by: string | null
          id: string
          mime_type: string | null
          object_path: string
          project_id: string | null
          workspace_id: string
        }
        Insert: {
          bucket: string
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          mime_type?: string | null
          object_path: string
          project_id?: string | null
          workspace_id: string
        }
        Update: {
          bucket?: string
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          mime_type?: string | null
          object_path?: string
          project_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_objects_project_workspace_fkey"
            columns: ["project_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "asset_objects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      background_jobs: {
        Row: {
          attempt_count: number
          billing_status: string
          canceled_at: string | null
          canvas_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          credits_cost: number | null
          credits_transaction_id: string | null
          error_code: string | null
          error_message: string | null
          estimated_cost_usd: number | null
          failed_at: string | null
          id: string
          job_type: Database["public"]["Enums"]["background_job_type"]
          max_attempts: number
          payload: Json
          project_id: string | null
          queue_name: string
          result: Json | null
          session_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["background_job_status"]
          thread_id: string | null
          updated_at: string
          workspace_id: string
          xy2api_key_id: number | null
          xy2api_request_id: string | null
        }
        Insert: {
          attempt_count?: number
          billing_status?: string
          canceled_at?: string | null
          canvas_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          credits_cost?: number | null
          credits_transaction_id?: string | null
          error_code?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          failed_at?: string | null
          id?: string
          job_type: Database["public"]["Enums"]["background_job_type"]
          max_attempts?: number
          payload?: Json
          project_id?: string | null
          queue_name: string
          result?: Json | null
          session_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["background_job_status"]
          thread_id?: string | null
          updated_at?: string
          workspace_id: string
          xy2api_key_id?: number | null
          xy2api_request_id?: string | null
        }
        Update: {
          attempt_count?: number
          billing_status?: string
          canceled_at?: string | null
          canvas_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          credits_cost?: number | null
          credits_transaction_id?: string | null
          error_code?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          failed_at?: string | null
          id?: string
          job_type?: Database["public"]["Enums"]["background_job_type"]
          max_attempts?: number
          payload?: Json
          project_id?: string | null
          queue_name?: string
          result?: Json | null
          session_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["background_job_status"]
          thread_id?: string | null
          updated_at?: string
          workspace_id?: string
          xy2api_key_id?: number | null
          xy2api_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "background_jobs_canvas_id_fkey"
            columns: ["canvas_id"]
            isOneToOne: false
            referencedRelation: "canvases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_kit_assets: {
        Row: {
          asset_type: Database["public"]["Enums"]["brand_kit_asset_type"]
          created_at: string
          display_name: string
          file_url: string | null
          id: string
          kit_id: string
          metadata: Json | null
          role: string | null
          sort_order: number
          text_content: string | null
          updated_at: string
        }
        Insert: {
          asset_type: Database["public"]["Enums"]["brand_kit_asset_type"]
          created_at?: string
          display_name?: string
          file_url?: string | null
          id?: string
          kit_id: string
          metadata?: Json | null
          role?: string | null
          sort_order?: number
          text_content?: string | null
          updated_at?: string
        }
        Update: {
          asset_type?: Database["public"]["Enums"]["brand_kit_asset_type"]
          created_at?: string
          display_name?: string
          file_url?: string | null
          id?: string
          kit_id?: string
          metadata?: Json | null
          role?: string | null
          sort_order?: number
          text_content?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_kit_assets_kit_id_fkey"
            columns: ["kit_id"]
            isOneToOne: false
            referencedRelation: "brand_kits"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_kits: {
        Row: {
          cover_url: string | null
          created_at: string
          guidance_text: string | null
          id: string
          is_default: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          guidance_text?: string | null
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          guidance_text?: string | null
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      canvases: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
          name: string
          project_id: string
          updated_at: string
        }
        Insert: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          name: string
          project_id: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          content_blocks: Json | null
          created_at: string
          id: string
          role: string
          session_id: string
          tool_activities: Json | null
        }
        Insert: {
          content?: string
          content_blocks?: Json | null
          created_at?: string
          id?: string
          role: string
          session_id: string
          tool_activities?: Json | null
        }
        Update: {
          content?: string
          content_blocks?: Json | null
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          tool_activities?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          canvas_id: string
          created_at: string
          created_by: string | null
          id: string
          thread_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          canvas_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          thread_id?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          canvas_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          thread_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_canvas_id_fkey"
            columns: ["canvas_id"]
            isOneToOne: false
            referencedRelation: "canvases"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_balances: {
        Row: {
          balance: number
          id: string
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          balance?: number
          id?: string
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          balance?: number
          id?: string
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_balances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          job_id: string | null
          metadata: Json | null
          transaction_type: Database["public"]["Enums"]["credit_transaction_type"]
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json | null
          transaction_type: Database["public"]["Enums"]["credit_transaction_type"]
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json | null
          transaction_type?: Database["public"]["Enums"]["credit_transaction_type"]
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "background_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_credit_claims: {
        Row: {
          amount: number
          claim_date: string
          created_at: string
          id: string
          workspace_id: string
        }
        Insert: {
          amount: number
          claim_date?: string
          created_at?: string
          id?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          claim_date?: string
          created_at?: string
          id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_credit_claims_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      home_discovery_cases: {
        Row: {
          author_avatar_url: string
          author_name: string
          case_url: string
          category_key: string
          cover_image_url: string
          created_at: string
          id: string
          is_active: boolean
          like_count: number
          seed_prompt: string
          sort_order: number
          title: string
          updated_at: string
          view_count: number
        }
        Insert: {
          author_avatar_url: string
          author_name: string
          case_url: string
          category_key: string
          cover_image_url: string
          created_at?: string
          id: string
          is_active?: boolean
          like_count?: number
          seed_prompt?: string
          sort_order?: number
          title: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          author_avatar_url?: string
          author_name?: string
          case_url?: string
          category_key?: string
          cover_image_url?: string
          created_at?: string
          id?: string
          is_active?: boolean
          like_count?: number
          seed_prompt?: string
          sort_order?: number
          title?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "home_discovery_cases_category_key_fkey"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "home_discovery_categories"
            referencedColumns: ["key"]
          },
        ]
      }
      home_discovery_categories: {
        Row: {
          created_at: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      home_example_categories: {
        Row: {
          accent: string | null
          created_at: string
          data_type: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          accent?: string | null
          created_at?: string
          data_type: string
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          accent?: string | null
          created_at?: string
          data_type?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      home_example_examples: {
        Row: {
          category_key: string
          created_at: string
          id: string
          image_urls: string[]
          input_mentions: Json
          is_active: boolean
          prompt: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          category_key: string
          created_at?: string
          id?: string
          image_urls?: string[]
          input_mentions?: Json
          is_active?: boolean
          prompt: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          category_key?: string
          created_at?: string
          id?: string
          image_urls?: string[]
          input_mentions?: Json
          is_active?: boolean
          prompt?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "home_example_examples_category_key_fkey"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "home_example_categories"
            referencedColumns: ["key"]
          },
        ]
      }
      payment_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_name: string
          id: string
          lemon_squeezy_event_id: string | null
          payload: Json
          processed: boolean
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_name: string
          id?: string
          lemon_squeezy_event_id?: string | null
          payload?: Json
          processed?: boolean
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_name?: string
          id?: string
          lemon_squeezy_event_id?: string | null
          payload?: Json
          processed?: boolean
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          archived_at: string | null
          brand_kit_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          slug: string
          thumbnail_path: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          brand_kit_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          slug: string
          thumbnail_path?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          brand_kit_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          slug?: string
          thumbnail_path?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_brand_kit_id_fkey"
            columns: ["brand_kit_id"]
            isOneToOne: false
            referencedRelation: "brand_kits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      skill_files: {
        Row: {
          content: string
          created_at: string
          file_path: string
          id: string
          mime_type: string
          skill_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          file_path: string
          id?: string
          mime_type?: string
          skill_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          file_path?: string
          id?: string
          mime_type?: string
          skill_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "skill_files_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          author: string
          category: string
          created_at: string
          created_by: string | null
          description: string
          icon_name: string | null
          id: string
          is_featured: boolean
          license: string | null
          metadata: Json | null
          name: string
          package_name: string | null
          skill_content: string
          slug: string
          source: string
          source_url: string | null
          updated_at: string
          version: string
        }
        Insert: {
          author?: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          icon_name?: string | null
          id?: string
          is_featured?: boolean
          license?: string | null
          metadata?: Json | null
          name: string
          package_name?: string | null
          skill_content: string
          slug: string
          source?: string
          source_url?: string | null
          updated_at?: string
          version?: string
        }
        Update: {
          author?: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          icon_name?: string | null
          id?: string
          is_featured?: boolean
          license?: string | null
          metadata?: Json | null
          name?: string
          package_name?: string | null
          skill_content?: string
          slug?: string
          source?: string
          source_url?: string | null
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billing_period: Database["public"]["Enums"]["billing_period"] | null
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          lemon_squeezy_customer_id: string | null
          lemon_squeezy_order_id: string | null
          lemon_squeezy_subscription_id: string | null
          lemon_squeezy_variant_id: string | null
          plan: Database["public"]["Enums"]["subscription_plan"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          billing_period?: Database["public"]["Enums"]["billing_period"] | null
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          lemon_squeezy_customer_id?: string | null
          lemon_squeezy_order_id?: string | null
          lemon_squeezy_subscription_id?: string | null
          lemon_squeezy_variant_id?: string | null
          plan?: Database["public"]["Enums"]["subscription_plan"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          billing_period?: Database["public"]["Enums"]["billing_period"] | null
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          lemon_squeezy_customer_id?: string | null
          lemon_squeezy_order_id?: string | null
          lemon_squeezy_subscription_id?: string | null
          lemon_squeezy_variant_id?: string | null
          plan?: Database["public"]["Enums"]["subscription_plan"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_chat_providers: {
        Row: {
          base_url: string
          created_at: string
          enabled: boolean
          id: string
          key_hint: string
          last_checked_at: string | null
          last_error: string | null
          models: string[]
          models_source: string
          name: string
          protocol: string
          secret_enc: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_url: string
          created_at?: string
          enabled?: boolean
          id?: string
          key_hint: string
          last_checked_at?: string | null
          last_error?: string | null
          models?: string[]
          models_source: string
          name: string
          protocol: string
          secret_enc: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_url?: string
          created_at?: string
          enabled?: boolean
          id?: string
          key_hint?: string
          last_checked_at?: string | null
          last_error?: string | null
          models?: string[]
          models_source?: string
          name?: string
          protocol?: string
          secret_enc?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["workspace_member_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_member_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["workspace_member_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          created_at: string
          default_model: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          default_model?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          default_model?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_skills: {
        Row: {
          config: Json | null
          enabled: boolean
          id: string
          installed_at: string
          installed_by: string | null
          skill_id: string
          workspace_id: string
        }
        Insert: {
          config?: Json | null
          enabled?: boolean
          id?: string
          installed_at?: string
          installed_by?: string | null
          skill_id: string
          workspace_id: string
        }
        Update: {
          config?: Json | null
          enabled?: boolean
          id?: string
          installed_at?: string
          installed_by?: string | null
          skill_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_skills_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          type: Database["public"]["Enums"]["workspace_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          type: Database["public"]["Enums"]["workspace_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          type?: Database["public"]["Enums"]["workspace_type"]
          updated_at?: string
        }
        Relationships: []
      }
      xy2api_accounts: {
        Row: {
          access_token_enc: string | null
          access_token_expires_at: string | null
          created_at: string
          email: string
          last_login_at: string
          last_validated_at: string | null
          refresh_token_enc: string | null
          role: string | null
          session_state: string
          status: string
          updated_at: string
          user_id: string
          username: string | null
          xy2api_user_id: number
        }
        Insert: {
          access_token_enc?: string | null
          access_token_expires_at?: string | null
          created_at?: string
          email: string
          last_login_at?: string
          last_validated_at?: string | null
          refresh_token_enc?: string | null
          role?: string | null
          session_state?: string
          status?: string
          updated_at?: string
          user_id: string
          username?: string | null
          xy2api_user_id: number
        }
        Update: {
          access_token_enc?: string | null
          access_token_expires_at?: string | null
          created_at?: string
          email?: string
          last_login_at?: string
          last_validated_at?: string | null
          refresh_token_enc?: string | null
          role?: string | null
          session_state?: string
          status?: string
          updated_at?: string
          user_id?: string
          username?: string | null
          xy2api_user_id?: number
        }
        Relationships: []
      }
      xy2api_api_keys: {
        Row: {
          allow_image_generation: boolean
          chat_models: string[]
          expires_at: string | null
          group_id: number | null
          group_name: string | null
          has_ip_restriction: boolean
          image_capable: boolean
          image_models: string[]
          invalid_reason: string | null
          key_id: number
          masked_key: string
          name: string
          platform: string | null
          pricing: Json
          quota: number
          quota_used: number
          secret_enc: string
          status: string
          subscription_type: string | null
          synced_at: string
          user_id: string
        }
        Insert: {
          allow_image_generation?: boolean
          chat_models?: string[]
          expires_at?: string | null
          group_id?: number | null
          group_name?: string | null
          has_ip_restriction?: boolean
          image_capable?: boolean
          image_models?: string[]
          invalid_reason?: string | null
          key_id: number
          masked_key: string
          name: string
          platform?: string | null
          pricing?: Json
          quota?: number
          quota_used?: number
          secret_enc: string
          status: string
          subscription_type?: string | null
          synced_at?: string
          user_id: string
        }
        Update: {
          allow_image_generation?: boolean
          chat_models?: string[]
          expires_at?: string | null
          group_id?: number | null
          group_name?: string | null
          has_ip_restriction?: boolean
          image_capable?: boolean
          image_models?: string[]
          invalid_reason?: string | null
          key_id?: number
          masked_key?: string
          name?: string
          platform?: string | null
          pricing?: Json
          quota?: number
          quota_used?: number
          secret_enc?: string
          status?: string
          subscription_type?: string | null
          synced_at?: string
          user_id?: string
        }
        Relationships: []
      }
      xy2api_preferences: {
        Row: {
          chat_key_id: number | null
          default_chat_model: string | null
          default_chat_provider_id: string | null
          default_image_model: string | null
          image_key_id: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_key_id?: number | null
          default_chat_model?: string | null
          default_chat_provider_id?: string | null
          default_image_model?: string | null
          image_key_id?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_key_id?: number | null
          default_chat_model?: string | null
          default_chat_provider_id?: string | null
          default_image_model?: string | null
          image_key_id?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "xy2api_preferences_chat_provider_owner_fk"
            columns: ["user_id", "default_chat_provider_id"]
            isOneToOne: false
            referencedRelation: "user_chat_providers"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_viewer: {
        Args: { p_email: string; p_user_id: string; p_user_meta: Json }
        Returns: string
      }
      claim_daily_credits: {
        Args: { p_amount: number; p_workspace_id: string }
        Returns: boolean
      }
      create_project_with_canvas: {
        Args: {
          p_canvas_name?: string
          p_description?: string
          p_name: string
          p_slug: string
          p_workspace_id: string
        }
        Returns: Json
      }
      deduct_credits: {
        Args: {
          p_amount: number
          p_description?: string
          p_job_id?: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: string
      }
      grant_plan_credits: {
        Args: {
          p_credits: number
          p_plan: Database["public"]["Enums"]["subscription_plan"]
          p_workspace_id: string
        }
        Returns: number
      }
      increment_job_attempt: {
        Args: { p_job_id: string }
        Returns: {
          attempt_count: number
          max_attempts: number
        }[]
      }
      refund_credits: {
        Args: {
          p_amount: number
          p_description?: string
          p_job_id: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: string
      }
      xy_runtime_permissions: { Args: never; Returns: boolean }
      xy_runtime_readiness: { Args: never; Returns: Json }
    }
    Enums: {
      background_job_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "canceled"
        | "dead_letter"
      background_job_type:
        | "image_generation"
        | "video_generation"
        | "code_execution"
      billing_period: "monthly" | "yearly"
      brand_kit_asset_type: "color" | "font" | "logo" | "image"
      credit_transaction_type:
        | "subscription_grant"
        | "daily_grant"
        | "purchase"
        | "generation_deduct"
        | "generation_refund"
        | "admin_adjustment"
        | "bonus"
      subscription_plan: "free" | "starter" | "pro" | "ultra" | "business"
      workspace_member_role: "owner" | "admin" | "member"
      workspace_type: "personal" | "team"
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
  langgraph: {
    Enums: {},
  },
  public: {
    Enums: {
      background_job_status: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "canceled",
        "dead_letter",
      ],
      background_job_type: [
        "image_generation",
        "video_generation",
        "code_execution",
      ],
      billing_period: ["monthly", "yearly"],
      brand_kit_asset_type: ["color", "font", "logo", "image"],
      credit_transaction_type: [
        "subscription_grant",
        "daily_grant",
        "purchase",
        "generation_deduct",
        "generation_refund",
        "admin_adjustment",
        "bonus",
      ],
      subscription_plan: ["free", "starter", "pro", "ultra", "business"],
      workspace_member_role: ["owner", "admin", "member"],
      workspace_type: ["personal", "team"],
    },
  },
} as const
