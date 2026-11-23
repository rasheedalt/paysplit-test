import json
from pathlib import Path

S = {"type": "string"}
I = {"type": "integer"}

def obj(properties, required=()):
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}

def body(schema):
    return {"required": True, "content": {"application/json": {"schema": schema}}}

def response(description, schema=None):
    value = {"description": description}
    if schema:
        value["content"] = {"application/json": {"schema": schema}}
    return value

def operation(summary, code, schema=None, auth=True, extra=None):
    value = {"summary": summary, "responses": {str(code): response("Success", schema), "400": response("Malformed request"), "401": response("Unauthorized"), "422": response("Validation error")}}
    if auth:
        value["security"] = [{"bearerAuth": []}]
    if extra:
        value.update(extra)
    return value

user = obj({"id": S, "email": S, "account_ref": S})
destination = obj({"id": S, "kind": {"type": "string", "enum": ["bank", "savings"]}, "name": S, "verified": {"type": "boolean"}})
rule = obj({"id": S, "destination_id": S, "kind": {"type": "string", "enum": ["fixed", "percent"]}, "value": I, "active": {"type": "boolean"}})
allocation = obj({"id": S, "rule_id": S, "destination_id": S, "amount": I, "status": S, "attempts": I, "error": {"type": ["string", "null"]}})
event = obj({"id": S, "amount": I, "currency": S, "received_at": S, "unallocated": I, "allocations": {"type": "array", "items": allocation}})
item_list = lambda item: obj({"items": {"type": "array", "items": item}})
path_id = {"parameters": [{"in": "path", "name": "id", "required": True, "schema": S}]}
spec = {
 "openapi": "3.1.0", "info": {"title": "PaySplit Sandbox API", "version": "0.1.0", "description": "NGN amounts use integer kobo. Percent rules use basis points. Bank verification and payouts are simulated; no real money moves."},
 "servers": [{"url": "http://localhost:8000"}],
 "components": {"securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer"}}},
 "paths": {
  "/health": {"get": operation("Health check", 200, obj({"status": S}), False)},
  "/v1/users": {"post": operation("Register user", 201, user, False, {"requestBody": body(obj({"email": S, "password": S}, ["email", "password"]))})},
  "/v1/sessions": {"post": operation("Create 24-hour bearer session", 201, obj({"access_token": S, "token_type": S, "expires_at": I}), False, {"requestBody": body(obj({"email": S, "password": S}, ["email", "password"]))})},
  "/v1/me": {"get": operation("Get current user", 200, user)},
  "/v1/destinations": {
   "post": operation("Create sandbox-verified bank or internal savings destination", 201, destination, True, {"requestBody": body(obj({"kind": S, "name": S, "bank_code": S, "account_number": S}, ["kind", "name"]))}),
   "get": operation("List destinations", 200, item_list(obj({"id": S, "kind": S, "name": S, "bank_code": {"type": ["string", "null"]}, "account_number": {"type": ["string", "null"]}, "verified": {"type": "boolean"}})))},
  "/v1/rules": {
   "post": operation("Create fixed-kobo or basis-point rule", 201, rule, True, {"requestBody": body(obj({"destination_id": S, "kind": S, "value": I}, ["destination_id", "kind", "value"]))}),
   "get": operation("List rules", 200, item_list(rule))},
  "/v1/rules/{id}": {"delete": operation("Deactivate rule for future salary events", 200, rule, True, path_id)},
  "/v1/webhooks/salary": {"post": operation("Receive signed salary event", 201, obj({"id": S, "duplicate": {"type": "boolean"}}), False, {"description": "HMAC SHA-256 over UTF-8 `timestamp.raw_body`; send hex digest in X-PaySplit-Signature. Timestamp within 300 seconds. Same event ID and payload returns 200.", "parameters": [{"in": "header", "name": "X-PaySplit-Timestamp", "required": True, "schema": S}, {"in": "header", "name": "X-PaySplit-Signature", "required": True, "schema": S}], "requestBody": body(obj({"event_id": S, "account_ref": S, "amount": I, "currency": S}, ["event_id", "account_ref", "amount"]))})},
  "/v1/salary-events": {"get": operation("List salary events", 200, item_list(obj({"id": S, "amount": I, "currency": S, "received_at": S})))},
  "/v1/salary-events/{id}": {"get": operation("Get salary split and payout states", 200, event, True, path_id)},
  "/v1/ledger": {"get": operation("List signed ledger postings", 200, item_list(obj({"id": S, "journal_id": S, "account": S, "amount": I, "created_at": S})))},
  "/openapi.json": {"get": operation("OpenAPI specification", 200, None, False)}
 }
}
Path("openapi.json").write_text(json.dumps(spec, indent=2) + "\n")
