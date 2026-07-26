# Semiconductor Domain Ontology Design

## Purpose

Define an ontology for the generated semiconductor wiki that makes real-world
industry relationships the primary graph while retaining an auditable path from
every node and edge to the wiki pages and SEC filing passages that support it.

This document defines the conceptual model only. It does not prescribe an
implementation or modify the current compiler pipeline.

## Design Principles

1. The prominent graph represents the semiconductor domain, not the filesystem
   or incidental similarity between Markdown pages.
2. Wiki pages are evidence containers that describe, compare, or discuss domain
   objects.
3. Every visible domain relationship must be supported by at least one exact
   filing citation.
4. Semantic similarity may help find candidates but cannot establish a
   relationship.
5. Explicit and inferred claims remain distinguishable. Inferred claims are
   hidden by default.
6. The ontology uses a small controlled vocabulary and does not provide a
   generic `relatedTo` escape hatch.
7. Time-sensitive and conflicting claims retain their temporal and dispute
   status.

## Chosen Architecture

The ontology has two linked layers.

### Domain layer

The primary layer contains real-world semiconductor subjects and typed
relationships. This is the default audience-facing graph.

### Knowledge and evidence layer

The secondary layer connects wiki pages and filing evidence to the domain
objects, attributes, and relationships they support. It answers why a domain
node or edge exists without making editorial structure the main story.

## Domain Node Types

### `Company`

Companies and institutions, including NVIDIA, AMD, Intel, TSMC, and ASML.
Supplier, foundry, partner, and competitor are roles expressed through
relationships rather than separate node types.

### `BusinessSegment`

Organizational business units such as Intel CCG, Intel DCAI, Intel Foundry, and
AMD Data Center, Client, Gaming, and Embedded.

### `ProductOrPlatform`

Commercial products, product families, and software or hardware platforms such
as Blackwell, Rubin, CUDA, NVIDIA AI Enterprise, DRIVE, Xeon, AMD Instinct,
EPYC, and Ryzen.

### `Technology`

Underlying technical capabilities such as GPU, CPU, DPU, FPGA/adaptive SoC,
NVLink, advanced packaging, and semiconductor process nodes.

### `Market`

Markets and application domains such as data-center AI, client computing,
gaming, embedded systems, automotive, and networking.

### `Strategy`

Persistent courses of action such as foundry strategy, AI ecosystem strategy,
strategic partnerships, and manufacturing strategy.

### `Risk`

Business exposures such as restricted market access, geopolitical exposure,
supply-chain dependency, IP dependency, and competitive pressure.

### `RegulationOrConstraint`

External rules or constraints such as United States export controls, licensing
requirements, and access restrictions. A constraint is separate from the risk
it creates.

## Domain Relationship Vocabulary

### Company structure and offerings

- `Company -> operates -> BusinessSegment`
- `Company -> offers -> ProductOrPlatform`
- `Company -> pursues -> Strategy`
- `Company -> exposedTo -> Risk`

### Products and technology

- `ProductOrPlatform -> uses -> Technology`
- `ProductOrPlatform -> targets -> Market`
- `ProductOrPlatform -> succeeds -> ProductOrPlatform`
- `ProductOrPlatform <-> competesWith <-> ProductOrPlatform`

### Business focus

- `BusinessSegment -> focusesOn -> Market`
- `BusinessSegment -> offers -> ProductOrPlatform`
- `Strategy -> targets -> Market`
- `Strategy -> dependsOn -> Company | Technology`

### Industry structure

- `Company <-> competesWith <-> Company`
- `Company <-> partnersWith <-> Company`
- `Company -> manufacturesThrough -> Company`
- `Company -> dependsOn -> Company | Technology`
- `Company -> licensesFrom -> Company`

### Risk and constraint

- `Risk -> affects -> Company | ProductOrPlatform | Strategy | Market`
- `Risk -> causedBy -> RegulationOrConstraint | Company | Technology`
- `RegulationOrConstraint -> restricts -> Company | ProductOrPlatform | Market`
- `Strategy -> mitigates -> Risk`

Symmetric relationships are stored canonically so the same fact cannot produce
duplicate reversed edges. Directed relationships preserve the direction stated
or entailed by the evidence.

## Knowledge and Evidence Layer

The supporting layer contains these relationships:

- `WikiPage -> describes -> DomainNode`
- `WikiPage -> compares -> DomainNode[]`
- `WikiPage -> discusses -> Strategy | Risk | Market`
- `WikiPage -> cites -> FilingEvidence`
- `FilingEvidence -> supports -> DomainRelationship`
- `FilingEvidence -> supports -> DomainNodeAttribute`

`FilingEvidence` identifies the filing and exact cited line range. A shared
source proves shared provenance only; it does not by itself prove a domain
relationship.

Page-to-page navigation is derived from the knowledge layer:

- Pages describing the same domain node are related.
- Comparison pages link to pages describing their compared subjects.
- Overview pages link to the strongest domain clusters they synthesize.

Derived navigation links are editorial aids and must not be presented as domain
facts.

## Relationship Evidence Contract

Every populated domain relationship records:

- stable source and target node identifiers;
- relationship type and direction;
- supporting wiki page identifiers;
- supporting filing and citation ranges;
- extraction method;
- `explicit` or `inferred` status;
- confidence;
- source filing date;
- validity interval when known; and
- dispute status when evidence conflicts.

An explicit relationship is directly stated by the cited evidence. An inferred
relationship requires a documented reasoning rule in addition to cited
evidence. Inferred relationships are excluded from the default graph.

## Population Process

For every compiled page:

1. Identify domain subjects explicitly named in cited paragraphs.
2. Normalize aliases to canonical nodes.
3. Extract only relationships supported by the cited paragraph.
4. Attach the exact page and filing citation to the claim.
5. Merge duplicate nodes and relationships across pages.
6. Mark interpretation beyond explicit wording as inferred.
7. Reject claims with ambiguous endpoints, unsupported direction, or missing
   evidence.

Title similarity and embedding similarity may propose candidates for review but
cannot create nodes or edges.

## Expected Clusters from the Current Wiki

### NVIDIA

Blackwell, Rubin, CUDA and CUDA-X, NVIDIA AI Enterprise, DRIVE, the data-center
platform, and export-control exposure.

### AMD

Data Center, Client and Gaming, Embedded and FPGA portfolios, AI strategy,
partnerships, and IP or licensing exposure.

### Intel

CCG, DCAI, Intel Foundry, process-node roadmap, advanced packaging,
manufacturing strategy, and the risk associated with pausing 14A development.

### Cross-industry

Competition, AI data-center growth, TSMC and ASML dependencies, supply-chain and
geopolitical exposure, and export restrictions.

These clusters are outcomes of typed domain facts, not manually drawn graph
communities.

## Quality and Failure Rules

- Reject unsupported or ambiguous relationships rather than substituting a
  generic edge.
- Do not infer competition solely because two products target a broadly similar
  market.
- Do not use current tense for evidence that supports only a historical fact.
- Preserve both supported claims when filings conflict and mark the
  relationship disputed.
- Do not merge similarly named products or companies without an explicit alias
  rule.
- Do not display an edge unless its supporting filing passage can be retrieved.
- Treat missing or malformed citations as relationship extraction failures, not
  warnings.

## Presentation Contract

The default graph displays explicit, cited domain nodes and relationships.
Selecting a node reveals its attributes and supporting pages. Selecting an edge
reveals its type, direction, filing passages, supporting pages, confidence, and
temporal or dispute status.

Editorial page relationships and inferred domain relationships are secondary
views. Users must opt in to display inferred relationships.

## Out of Scope

- A complete semiconductor industry ontology.
- Automatic relationship creation from embedding similarity.
- Uncited market knowledge or external enrichment.
- Treating every noun or wiki title as a domain entity.
- Compiler, schema, UI, or runtime implementation.
