# JAAG: a JSON input file Assembler for AlphaFold 3, OpenDDE, Protenix, OpenFold 3, Chai-1, and Boltz with Glycan integration

JAAG is a comprehensive web-based tool for generating input files for the major open AlphaFold-3-family structure prediction models — AlphaFold 3, OpenDDE, Protenix, OpenFold 3, Chai-1, and Boltz — with advanced glycan structure support and integrated SugarDrawer functionality.
Web tool link: https://biofgreat.org/JAAG/  
Full tutorial PDF: https://www.biofgreat.org/JAAG/Tutorial.pdf  
Full tutorial PowerPoint with animation: https://biofgreat.org/JAAG/Tutorial.pptx

## Key Features

### AlphaFold 3 JSON Generation
- **Complete AF3 v4 Support**: Full implementation of AlphaFold 3 v4 input format specification
- **Multi-sequence Modeling**: Support for protein, ligand, RNA, and DNA sequences in complex assemblies
- **Real-time JSON Generation**: Automatic JSON updates as inputs change with live validation
- **Sequence Multimer**: Automatic appending of iterated alphabets after the user-defined chain ID
- **Advanced Configuration**: Model seeds generator (single/multiple), MSA files, templates, custom CCDs
- **AF 3 Input Full Guide**: https://github.com/google-deepmind/alphafold3/blob/main/docs/input.md

### OpenDDE JSON Generation

- **AlphaFold Server-style JSON**: Generates OpenDDE's required top-level job list and entity names
- **Shared JAAG Editor**: Reuses protein, DNA, RNA, ligand, glycan, multimer, modification, MSA-path, and covalent-bond inputs
- **Target-aware Validation**: Prevents unsupported AlphaFold-only fields from being copied or downloaded as valid OpenDDE JSON
- **OpenDDE Input Guide**: https://github.com/aurekaresearch/OpenDDE/blob/main/docs/infer_json_format.md

### Protenix JSON Generation

- **Protenix Job-list JSON**: Generates Protenix's required top-level job list and entity names
- **Shared JAAG Editor**: Reuses the same protein, DNA, RNA, ligand, glycan, multimer, modification, MSA-path, and covalent-bond inputs
- **Target-aware Validation**: Reports Protenix-specific compatibility errors before copy or download
- **Protenix Input Guide**: https://github.com/bytedance/Protenix/blob/main/docs/infer_json_format.md

### Unified input and share links

JAAG first represents every job as a versioned, target-neutral `jaag-superset`
document. Explicit AlphaFold 3, OpenDDE, Protenix, OpenFold 3, Chai-1, and Boltz
adapters then serialize that document to the selected output format. This keeps
form collection, common validation, and target conversion separate.

#### JAAG target compatibility

The output "format" column notes the payload type each target requests: OpenDDE,
Protenix and OpenFold 3 take JSON files, Chai-1 takes a FASTA file, and Boltz
takes a YAML file.

| Input behavior | AlphaFold 3 standalone | OpenDDE / Protenix | OpenFold 3 | Chai-1 | Boltz |
| --- | --- | --- | --- | --- | --- |
| Output format | JSON | JSON job list | JSON `queries` | FASTA | YAML |
| Top-level JSON | One object with `dialect` and `version` | Job list | `{ "queries": { "<name>": { "chains": [...] } } }` | n/a | n/a |
| Entity keys | `protein`, `dna`, `rna`, `ligand` | `proteinChain`, `dnaSequence`, `rnaSequence`, `ligand` | `molecule_type` + `chain_ids` | `protein\|rna\|dna\|ligand` FASTA headers | `protein`, `dna`, `rna`, `ligand` |
| Multimer IDs | String or ID array | ID array plus `count` | String or ID array | n/a | ID array |
| MSA paths | Protein: paired/unpaired; RNA: unpaired | Protein: paired/unpaired; RNA: unpaired | `main_msa_file_paths` / `paired_msa_file_paths` | Not encoded (CLI `--msa-directory`) | Protein `msa:` |
| Inline MSA | Protein: paired/unpaired; RNA: unpaired | Not supported | Not supported | Not supported | Not supported |
| AlphaFold template objects | Supported | Not supported | Not supported (native `template_cif_paths`) | Not supported (CLI m8 templates) | Not supported (native `templates` section) |
| Custom `userCCD` | Supported | Only JAAG built-in aliases | Not supported | Not supported | Not supported |
| Covalent bonds | `bondedAtomPairs` with chain IDs | `covalent_bonds` with entity/copy indices | Not supported | Not supported (constraints TSV) | `constraints.bond` |
| Sequence descriptions | Preserved | Omitted with a warning | n/a | n/a | n/a |
| Ligand file paths | Not supported | Serialized as `FILE_<path>` | Not supported | Not supported | Not supported |

File-backed ligands can be serialized through the neutral schema and `/fetch`,
but the current browser form cannot restore them from a share link. JAAG rejects
that restoration explicitly instead of changing the ligand type.

The **Share** button stores that neutral input in the `p` query parameter as
pako/DEFLATE-compressed JSON encoded with URL-safe base64. Opening the link
restores the editable input. Compression is not encryption: anyone with the URL
can recover the input, and the URL may be retained in browser history or server
logs.

The same payload can be downloaded non-interactively from `/fetch`:

```bash
curl -fL 'https://example.org/fetch?p=PAYLOAD' -o input.json
wget --content-disposition 'https://example.org/fetch?p=PAYLOAD'
```

Valid payloads return the selected target's input file (JSON, FASTA, or YAML
depending on the target) with an attachment filename.
Malformed, oversized, schema-invalid, or target-incompatible payloads return a
non-success response and never carry an attachment header.

### Glycan Structure Management
- **Integrated SugarDrawer**: Built-in glycan drawing interface with popup modal support
- **GlycoCT Processing**: Full GlycoCT format parsing and conversion to bondedAtomPairs + CCD codes
- **Substituent Handling**: Support for glycan sulfation, phosphorylation, acetylation and methylation
- **Glycoinformatics Database Lookup**: Look up glycan information from GlyGen and GlyTouCan

### Protein Glycosylation
- **Sequon Detection**: Detection of N-linked glycosylation sequons (N-X-S/T)
- **Glycosylation Sites**: Manual addition of custom glycosylation sites
### Glycan-related AF3 Model Interpretation: 
Chin Huang, Natarajan Kannan, Kelley W Moremen, Modeling glycans with AlphaFold 3: capabilities, caveats, and limitations, Glycobiology, Volume 35, Issue 10, October 2025, cwaf048, https://doi.org/10.1093/glycob/cwaf048
## Quick Start (through server: https://biofgreat.org/JAAG/)
1. **Basic Setup**: Enter a job name and choose AlphaFold 3 standalone, OpenDDE, Protenix, OpenFold 3, Chai-1, or Boltz
2. **Add Sequences**: Use the sequence buttons to add proteins, ligands, RNA, or DNA
3. **Draw Glycans**: Click the pencil icon to open SugarDrawer for glycan structure drawing  
   **Alternatives**: Copy and paste GlycoCT from a glycoinformatics database
4. **Generate JSON**: JSON is automatically generated in real-time
5. **Export**: Copy or download the input file for the selected target

## Quick Start (through download)
1. **Download**: Download or clone this repo to your local machine
2. **Install Dependencies**: Install Node.js then in SugarDrawer directory, run:
   ```
   npm install
   ```
   ```
   npm run build
   ```
   SugarDrawer will be built and the GAG templates will be patched
3. **Serve the Tool**: From the repository root, start a local HTTP server:
   ```
   python3 -m http.server 8000
   ```
4. **Open the Tool**: Visit `http://localhost:8000/` in a modern web browser.
   Opening `index.html` directly with a `file://` URL is not supported because
   browsers block the shared JavaScript modules in that mode.

## OpenDDE compatibility

OpenDDE uses AlphaFold Server-style entity names rather than the standalone
AlphaFold 3 dialect. JAAG converts the selected job automatically:

| JAAG input | OpenDDE output |
| --- | --- |
| Protein, DNA, RNA | `proteinChain`, `dnaSequence`, `rnaSequence` |
| Chain ID or multimer IDs | `id` list with matching `count` |
| CCD ligand or glycan | Joined `CCD_...` ligand string |
| SMILES ligand | OpenDDE ligand string |
| `bondedAtomPairs` | Entity/copy-based `covalent_bonds` |
| Protein, DNA, RNA modifications | OpenDDE modification fields with `CCD_` prefixes |
| Paired/unpaired MSA paths | Preserved as file paths |

OpenDDE does not accept inline MSA text, AlphaFold template objects, or custom
`userCCD` data. JAAG reports these as validation errors instead of silently
discarding them. Sequence descriptions are omitted with a warning. The known
AlphaFold-only aliases `SIA-2`, `SLB-2`, `NGC-2`, and `NGE-2` are mapped back
to their standard CCD IDs.

Example output:

```json
[
  {
    "name": "example_job",
    "modelSeeds": [101],
    "sequences": [
      {
        "proteinChain": {
          "count": 1,
          "id": ["A"],
          "sequence": "ACDEFGHIK"
        }
      }
    ]
  }
]
```

Run the downloaded file with a standalone OpenDDE installation:

```bash
opendde pred -i input.json -o ./output
```

## Protenix compatibility

Protenix's documented job-list format overlaps with the OpenDDE fields JAAG
exports. Select **Protenix** to generate target-labelled validation messages and
a directly usable Protenix input file. The same AlphaFold-only field limitations
apply to this shared JAAG export path.

Run the downloaded file with a standalone Protenix installation:

```bash
protenix pred -i input.json -o ./output -n protenix_base_default_v1.0.0
```

## OpenFold 3 compatibility

OpenFold 3 takes a JSON file whose top level is a `queries` dictionary. JAAG
maps each job to a single query named after the job name, with one chain per
entity:

```json
{
  "queries": {
    "example_job": {
      "chains": [
        {
          "molecule_type": "protein",
          "chain_ids": "A",
          "sequence": "ACDEFGHIK",
          "non_canonical_residues": { "1": "MSE" }
        },
        {
          "molecule_type": "ligand",
          "chain_ids": "L",
          "smiles": "CCO"
        }
      ]
    }
  }
}
```

Precomputed MSA paths map to `main_msa_file_paths`/`paired_msa_file_paths`.
OpenFold 3 does not accept AlphaFold template objects, custom `userCCD`, or
`bondedAtomPairs` between chains — JAAG reports these as validation errors. Model
seeds are passed on the OpenFold 3 command line, not in the input JSON.

Run the downloaded file with a standalone OpenFold 3 installation:

```bash
openfold3-predict -i input.json -o ./output --use_msa_server
```

## Chai-1 compatibility

Chai-1's `chai-lab fold` command reads sequences from a **FASTA** file rather
than JSON. JAAG writes one FASTA block per entity with Chai-1's
`entity_type|name=CHAIN` headers, and SMILES on the sequence line for ligands:

```text
>protein|name=A
ACDEFGHIK
>ligand|name=L
CCO
```

Protein/DNA/RNA modifications are written inline with Chai-1's bracket notation
(e.g. `AC(MSE)DEF...`), and multi-copy chains inherit their first chain ID as the
FASTA name. Chai-1 reads MSAs and templates from separate CLI files, not the
FASTA, so JAAG emits a warning instead of embedding them. CCD-only ligands and
`bondedAtomPairs` cannot be represented in the FASTA and are reported as errors.

Run the downloaded file with a standalone Chai-1 installation:

```bash
chai-lab fold --use-msa-server --use-templates-server input.fasta output_folder
```

## Boltz compatibility

Boltz's `boltz predict` command reads a **YAML** file. JAAG writes the `version`,
`sequences`, and (when present) `constraints` sections:

```yaml
version: 1
sequences:
  - protein:
      id: [A]
      sequence: ACDEFGHIK
      msa: ./msa/a.a3m
      modifications:
        - position: 1
          ccd: MSE
  - ligand:
      id: [L]
      smiles: CCO
constraints:
  - bond:
      atom1: ['A', 1, 'N']
      atom2: ['L', 1, 'C1']
```

Protein MSA paths map to `msa:`. Protein/DNA/RNA modifications map to a
`modifications` list, and `bondedAtomPairs` map to `constraints.bond`. Boltz does
not accept AlphaFold template objects or custom `userCCD`, and each ligand must
resolve to a single CCD code or a SMILES string — JAAG reports the corresponding
validation errors.

Run the downloaded file with a standalone Boltz installation:

```bash
boltz predict input.yaml --use_msa_server
```

## Guide

### Basic Protein Job Example
1. Job Name: `b3gnt2_dimer`
2. Add protein sequence with chain ID `BTHREEGNTTWO`  
   Note: only alphabets are allowed
3. Enter sequence: `MSVGRRRIKL...`  
   Alternatives: enter UniProt ID `Q9NY97` to fetch the sequence
4. Toggle Count to 2 for dimer
5. Complete JSON is ready for AlphaFold 3

### Glycoprotein
1. Add protein sequence
2. Enable "Detect sequons" to detect N-glycosylation sites  
   Alternatives: manually add glycosylation sites
3. Draw glycan structure using SugarDrawer and export  
   Alternative 1: select glycan from templates  
   Alternative 2: copy and paste GlycoCT from glycoinformatics database
4. CCDs and bondedAtomPairs are automatically generated
5. Complete JSON is ready for AlphaFold 3

### Glycan as Ligand
1. Add protein sequence
2. Add ligand sequence
3. Draw glycan structure using SugarDrawer and export  
   Alternatives: copy and paste GlycoCT from glycoinformatics database
4. Define custom bondedAtomPairs if needed (optional)
5. Complete JSON is ready for AlphaFold 3

### Other Molecules as Ligand
1. Add protein sequence
2. Add ligand sequence
3. Add CCD codes or SMILES
   Note: only one ligand input method can exist in a JSON file
4. Define custom bondedAtomPairs if needed (optional)  
   Note 1: bondedAtomPairs is only available for CCDs  
   Note 2: when linking multiple CCDs into a larger molecule, it is recommended to define them within the same chain ID  
   Note 3: Atom names in each CCD are available from PDBeChem or RCSB PDB
5. Complete JSON is ready for AlphaFold 3

## Other Notes

- **Validation Required**: Resolve JAAG validation errors before submitting JSON to AlphaFold 3, OpenDDE, or Protenix
- **Sequence Limits**: Be aware of AlphaFold 3 sequence length limitations (around 5000 tokens)
- **Database Availability**: External database lookups depend on server availability
- **Privacy**: Normal editing stays in the browser. Share links contain compressed input data in their URL; compression is not encryption, and the URL may appear in browser history or server logs. When using glycan lookup features, the app makes direct client-side requests to third-party APIs (e.g., GlyGen, GlyTouCan).

## Acknowledgments

This tool builds upon excellent work from the scientific community and open-source projects:

### Software & Libraries
- **SugarDrawer**: The Noguchi Institute (Apache-2.0)
  - License: https://www.apache.org/licenses/LICENSE-2.0
  - GitLab: https://gitlab.com/glycoinfo/sugardrawer

- **SugarSketcher**: The Noguchi Institute (Apache-2.0)
  - License: https://www.apache.org/licenses/LICENSE-2.0
  - GitLab: https://gitlab.com/glycoinfo/sugardrawer/SugarSketcher2.git

- **Bootstrap 5**: Frontend framework (MIT)
  - License: https://github.com/twbs/bootstrap/blob/main/LICENSE
- **Font Awesome**: Icon library (Font Awesome Free License)
  - License: https://fontawesome.com/license/free

### Used Databases
- **[UniProt](https://www.uniprot.org/)**
- **[GlyGen](https://www.glygen.org/)**
- **[GlyTouCan](https://glytoucan.org/)**
- **[RCSB PDB](https://www.rcsb.org/)**
- **[PDBeChem](https://www.ebi.ac.uk/pdbe-srv/pdbechem/)**

## Funding
This project is supported by:
- U.S. National Science Foundation BioFoundry: Glycoscience Research, Education and Training
- University of Georgia

## License

This project is licensed under the Apache License, Version 2.0. See `LICENSE` for details.

## Citation

If you use JAAG in your research, please cite:
- **JAAG**: 
```
@article{Huang2025,
  author  = {Huang, Chin and Moremen, Kelley W.},
  journal = {TBD},
  title   = {JAAG: a JSON input file Assembler for AlphaFold 3 with Glycan integration},
  year    = {2025},
  volume  = {TBD},
  doi     = {TBD}
}

```
- **AlphaFold 3**: 
```
@article{Abramson2024,
  author  = {Abramson, Josh and Adler, Jonas and Dunger, Jack and Evans, Richard and Green, Tim and Pritzel, Alexander and Ronneberger, Olaf and Willmore, Lindsay and Ballard, Andrew J. and Bambrick, Joshua and Bodenstein, Sebastian W. and Evans, David A. and Hung, Chia-Chun and O’Neill, Michael and Reiman, David and Tunyasuvunakool, Kathryn and Wu, Zachary and Žemgulytė, Akvilė and Arvaniti, Eirini and Beattie, Charles and Bertolli, Ottavia and Bridgland, Alex and Cherepanov, Alexey and Congreve, Miles and Cowen-Rivers, Alexander I. and Cowie, Andrew and Figurnov, Michael and Fuchs, Fabian B. and Gladman, Hannah and Jain, Rishub and Khan, Yousuf A. and Low, Caroline M. R. and Perlin, Kuba and Potapenko, Anna and Savy, Pascal and Singh, Sukhdeep and Stecula, Adrian and Thillaisundaram, Ashok and Tong, Catherine and Yakneen, Sergei and Zhong, Ellen D. and Zielinski, Michal and Žídek, Augustin and Bapst, Victor and Kohli, Pushmeet and Jaderberg, Max and Hassabis, Demis and Jumper, John M.},
  journal = {Nature},
  title   = {Accurate structure prediction of biomolecular interactions with AlphaFold 3},
  year    = {2024},
  volume  = {630},
  number  = {8016},
  pages   = {493–500},
  doi     = {10.1038/s41586-024-07487-w}
}
```
