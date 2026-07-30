# ADR-0001: Modular Monolith First

**Status:** Accepted

MyWat remains one deployable application with explicit module boundaries. We avoid premature microservices while preserving event, command and query contracts that allow extracting high-load modules later.
