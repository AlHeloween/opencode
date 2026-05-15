import { Resource } from "@opencode-ai/console-resource"

async function login() {
  const url = Resource.SALESFORCE_INSTANCE_URL.value.replace(/\/$/, "")
  const clientId = Resource.SALESFORCE_CLIENT_ID.value
  const clientSecret = Resource.SALESFORCE_CLIENT_SECRET.value

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  })

  const res = await fetch(`${url}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  }).catch((err) => {
    console.error("[salesforce] Failed to fetch access token:", err)
  })

  if (!res) return

  if (!res.ok) {
    console.error("[salesforce] Failed to fetch access token:", res.status, await res.text())
    return
  }

  const data = (await res.json()) as { access_token?: string; instance_url?: string }
  if (!data.access_token) {
    console.error("[salesforce] Auth response missing access token")
    return
  }

  return {
    token: data.access_token,
    url: data.instance_url ?? url,
  }
}

export interface SalesforceLeadInput {
  name: string
  role: string
  company?: string
  email: string
  phone?: string
  message: string
}

export async function createLead(input: SalesforceLeadInput): Promise<boolean> {
  const auth = await login()
  if (!auth) return false

  const res = await fetch(`${auth.url}/services/data/v59.0/sobjects/Lead`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      LastName: input.name,
      Company: input.company?.trim() || "Website",
      Email: input.email,
      Phone: input.phone ?? null,
      Title: input.role,
      Description: input.message,
      LeadSource: "Website",
    }),
  }).catch((err) => {
    console.error("[salesforce] Failed to create lead:", err)
  })

  if (!res) return false

  if (!res.ok) {
    console.error("[salesforce] Failed to create lead:", res.status, await res.text())
    return false
  }

  return true
}
