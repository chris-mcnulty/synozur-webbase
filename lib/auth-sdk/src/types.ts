// Shared types between browser and server consumers of the OAuth provider.

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  scopes_supported: string[];
  response_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

export interface UserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  // The provider includes capabilities + roles in the access token's `cap` /
  // `roles` claims; userinfo only carries identity claims.
}

export interface AccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  scope: string;
  cap: string[];
  roles: string[];
  typ: "access";
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}
