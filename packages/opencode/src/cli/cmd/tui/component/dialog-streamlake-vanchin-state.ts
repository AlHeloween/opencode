export const STREAMLAKE_VANCHIN_PROVIDER_ID = "streamlake-vanchin"
export const STREAMLAKE_VANCHIN_PAYG_BASE_URL = "https://vanchin.streamlake.ai/api/gateway/v1/endpoints"
export const STREAMLAKE_VANCHIN_CATALOG_SOURCE = "https://www.streamlake.com/document/WANQING/mdrax1ixkgpgh1ms1na"

type Modality = "text" | "image" | "video"

export type StreamLakeVanchinModelProfile = {
  name: string
  category: "Text" | "Multimodal"
  reasoning: boolean
  tool_call?: true
  limit: {
    context: number
    output?: number
  }
  modalities: {
    input: Modality[]
    output: ["text"]
  }
}

/** Snapshot of selected active Vanchin chat-model profiles from the official catalog. */
export const STREAMLAKE_VANCHIN_MODELS: StreamLakeVanchinModelProfile[] = [
  {
    "name": "GLM-5.3",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 1024000
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    }
  },
  {
    "name": "GLM-5.1",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 204800,
      "output": 131072
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "MiMo-V2-Pro",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 1048576,
      "output": 131072
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "MiniMax-M2.7",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 204800,
      "output": 131072
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "GLM-5-Turbo",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 204800,
      "output": 131072
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "MiniMax-M2.5",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 204800,
      "output": 131072
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "GLM-5",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 204800,
      "output": 131072
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3-Coder-Next",
    "category": "Text",
    "reasoning": false,
    "limit": {
      "context": 262144,
      "output": 65536
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    }
  },
  {
    "name": "MiniMax-M2.1-Lightning",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 204800,
      "output": 131072
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Kimi-K2-Thinking",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 262144,
      "output": 16384
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "GLM-4.7",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 204800,
      "output": 131072
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "MiniMax-M2.1",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 204800,
      "output": 131072
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "MiniMax-M2",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 131072,
      "output": 131072
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "GLM-4.6",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 204800,
      "output": 131072
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3-235B-A22B-Instruct-2507",
    "category": "Text",
    "reasoning": false,
    "limit": {
      "context": 131072,
      "output": 32768
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3-30B-A3B-Thinking-2507",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 131072,
      "output": 32768
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3-30B-A3B-Instruct-2507",
    "category": "Text",
    "reasoning": false,
    "limit": {
      "context": 131072,
      "output": 32768
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3-235B-A22B-Thinking-2507",
    "category": "Text",
    "reasoning": false,
    "limit": {
      "context": 131072,
      "output": 32768
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Kimi-K2-Instruct",
    "category": "Text",
    "reasoning": false,
    "limit": {
      "context": 131072,
      "output": 8192
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen2.5-7B-Instruct",
    "category": "Text",
    "reasoning": false,
    "limit": {
      "context": 32768,
      "output": 8192
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3-8B",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 32768,
      "output": 8192
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3-32B",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 32768,
      "output": 8192
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3-30B-A3B",
    "category": "Text",
    "reasoning": true,
    "limit": {
      "context": 32768,
      "output": 8192
    },
    "modalities": {
      "input": [
        "text"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Kimi-K2.7-Code",
    "category": "Multimodal",
    "reasoning": true,
    "limit": {
      "context": 262144,
      "output": 32768
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Keye-VL-2.0-30B-A3B",
    "category": "Multimodal",
    "reasoning": true,
    "limit": {
      "context": 262144,
      "output": 65536
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3.6-27B",
    "category": "Multimodal",
    "reasoning": false,
    "limit": {
      "context": 262144,
      "output": 65536
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Kimi-K2.6",
    "category": "Multimodal",
    "reasoning": false,
    "limit": {
      "context": 262144,
      "output": 262144
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3.5-27B",
    "category": "Multimodal",
    "reasoning": false,
    "limit": {
      "context": 262144,
      "output": 65536
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3.5-35B-A3B",
    "category": "Multimodal",
    "reasoning": false,
    "limit": {
      "context": 262144,
      "output": 65536
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3.5-122B-A10B",
    "category": "Multimodal",
    "reasoning": false,
    "limit": {
      "context": 262144,
      "output": 65536
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3.5-Plus",
    "category": "Multimodal",
    "reasoning": false,
    "limit": {
      "context": 1024000,
      "output": 65536
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3.5-397B-A17B",
    "category": "Multimodal",
    "reasoning": false,
    "limit": {
      "context": 262144,
      "output": 65536
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Kimi-K2.5",
    "category": "Multimodal",
    "reasoning": false,
    "limit": {
      "context": 262144,
      "output": 262144
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3-VL-235B-A22B-Instruct",
    "category": "Multimodal",
    "reasoning": false,
    "limit": {
      "context": 131072,
      "output": 32768
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  },
  {
    "name": "Qwen3-VL-235B-A22B-Thinking",
    "category": "Multimodal",
    "reasoning": false,
    "limit": {
      "context": 131072,
      "output": 32768
    },
    "modalities": {
      "input": [
        "text",
        "image",
        "video"
      ],
      "output": [
        "text"
      ]
    },
    "tool_call": true
  }
]

/** Account-scoped inference endpoint IDs are the only safe runtime model identifiers. */
export function streamLakeVanchinEndpointID(value: string) {
  const endpointID = value.trim()
  return /^ep-[A-Za-z0-9-]+$/.test(endpointID) ? endpointID : undefined
}

/** RFC 7386 patch: add one selected endpoint without rewriting unrelated providers. */
export function streamLakeVanchinConfig(endpointID: string, profile: StreamLakeVanchinModelProfile) {
  const model = {
    name: profile.name,
    reasoning: profile.reasoning,
    ...(profile.reasoning ? { options: { enable_thinking: true } } : {}),
    ...(profile.tool_call ? { tool_call: true } : {}),
    limit: profile.limit,
    modalities: profile.modalities,
  }
  return {
    provider: {
      [STREAMLAKE_VANCHIN_PROVIDER_ID]: {
        models: {
          [endpointID]: model,
        },
      },
    },
  }
}
