import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace Example;

@id("Role")
enum Role {
  admin: "admin",
  member: "member",
}

@id("User")
model User {
  id: string;
  role: Role;
  active: boolean;
  displayName?: string;
}
