module Locks {
  method CheckTtl(ttl_ms: int) returns (result: bool)
    requires ttl_ms >= 0
    ensures result <==> ttl_ms > 0
  {
    result := ttl_ms > 0;
  }
}
