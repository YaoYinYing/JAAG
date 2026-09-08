/* REvoCompute — JAAG structure input builder (canonical, shared across runner families). */
/* SPDX-License-Identifier: GPL-3.0-only */
/* Depends on global.JAAGCore (bundled or loaded separately). See scripts/build-revocompute-plugin.mjs. */

(function (global) {
  "use strict";

  var workspaceApi = global.REvoComputeInputWorkspace;
  if (!workspaceApi) throw new Error("input-workspace.js must be loaded before the jaag-builder plugin");
  var core = global.JAAGCore;
  if (!core) throw new Error("JAAG core (global.JAAGCore) must be loaded before the jaag-builder plugin");

  var ENTITY_TYPES = ["protein", "dna", "rna", "ligand"];

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function labelled(control, labelText) {
    var wrap = element("div", "builder-field");
    var label = element("label", "param-label", labelText);
    wrap.appendChild(label);
    wrap.appendChild(control);
    return wrap;
  }

  function textInput(value, placeholder) {
    var input = element("input", "text-input");
    input.type = "text";
    input.value = value || "";
    if (placeholder) input.placeholder = placeholder;
    return input;
  }

  function textArea(value, placeholder) {
    var area = element("textarea", "sequence-input");
    area.value = value || "";
    if (placeholder) area.placeholder = placeholder;
    return area;
  }

  function select(options, selected) {
    var control = element("select", "text-input");
    options.forEach(function (option) {
      var node = element("option", "", option.label);
      node.value = option.value;
      node.selected = option.value === selected;
      control.appendChild(node);
    });
    // Real <select> elements derive .value from the selected <option>, but the
    // minimal DOM used by the contract-test harness keeps .value as a plain
    // property. Set it explicitly so both real browsers and the harness agree.
    control.value = selected !== undefined ? selected : (options[0] ? options[0].value : "");
    return control;
  }

  function parseSeedsInput(value) {
    return core.parseSeeds(value);
  }

  // Accept both a single string (e.g. 'A') and an array of chain IDs (e.g.
  // ['A', 'B']); the seeded starter entity passes a string, but host code may
  // also preload an array.
  function chainIdsText(value) {
    if (value == null) return "";
    return (Array.isArray(value) ? value : [value])
      .map(function (id) { return String(id); })
      .filter(Boolean)
      .join(",");
  }

  function parseModifications(raw, entityType) {
    var modifications = [];
    String(raw || "").split(/,/).filter(Boolean).forEach(function (item) {
      var parts = item.trim().split(":");
      if (parts.length !== 2) return;
      var position = Number(parts[0]);
      var ccdCode = parts[1].trim();
      if (!Number.isInteger(position) || position < 1 || !ccdCode) return;
      modifications.push({ ccdCode: ccdCode, position: position });
    });
    return modifications;
  }

  function parseBonds(raw) {
    var bonds = [];
    String(raw || "").split(/\n/).filter(function (line) { return line.trim(); }).forEach(function (line) {
      var halves = line.trim().split(/\s+/);
      if (halves.length !== 2) return;
      function endpoint(text) {
        var parts = text.split(":");
        if (parts.length !== 3) return null;
        var position = Number(parts[1]);
        if (!Number.isInteger(position) || position < 1) return null;
        return { chainId: parts[0].trim(), position: position, atom: parts[2].trim() };
      }
      var left = endpoint(halves[0]);
      var right = endpoint(halves[1]);
      if (left && right) bonds.push({ left: left, right: right });
    });
    return bonds;
  }

  workspaceApi.registry.register({
    id: "jaag-builder",
    mount: function (target, definition, context) {
      var options = definition.options || {};
      var allowedTargets = Array.isArray(options.targets) && options.targets.length
        ? options.targets
        : ["alphafold3", "opendde"];
      var targetName = options.target && allowedTargets.indexOf(options.target) >= 0
        ? options.target
        : allowedTargets[0];

      var targetSelect = select(allowedTargets.map(function (name) {
        return { value: name, label: name === "opendde" ? "OpenDDE" : name === "protenix" ? "Protenix" : name === "chai" ? "Chai-1" : name === "boltz" ? "Boltz" : "AlphaFold 3" };
      }), targetName);

      var nameInput = textInput("", "job name");
      var seedsInput = textInput("1", "model seeds, e.g. 1, 2, 3");
      var bondsArea = textArea("", "one bond per line: A:2:ND2 G:1:C1");

      var entityRows = [];
      var entityList = element("div", "builder-entities");

      function addEntityRow(initial) {
        var row = element("div", "builder-entity");
        var typeSelect = select(ENTITY_TYPES.map(function (type) { return { value: type, label: type }; }), (initial && initial.type) || "protein");
        var chainInput = textInput(chainIdsText(initial && initial.chainIds), "chain IDs, comma separated");
        var sequenceArea = textArea((initial && initial.sequence) || "", "sequence");
        var ligandInput = textInput((initial && initial.ligand && (initial.ligand.smiles || initial.ligand.ccdCodes)) || "", "CCD codes (NAG,FUC) or SMILES");
        var modificationsInput = textInput(stringifyModifications(initial && initial.modifications), "modifications: position:CCD");
        var msaInput = textInput(initial && initial.msa && initial.msa.unpaired && initial.msa.unpaired.value || "", "/path/to/unpaired.a3m");
        var remove = element("button", "btn btn-soft", "Remove"); remove.type = "button";

        row.appendChild(typeSelect);
        row.appendChild(chainInput);
        row.appendChild(labelled(sequenceArea, "Sequence"));
        row.appendChild(labelled(ligandInput, "Ligand (CCD codes or SMILES)"));
        row.appendChild(labelled(modificationsInput, "Modifications"));
        row.appendChild(labelled(msaInput, "Unpaired MSA path"));
        row.appendChild(remove);
        entityList.appendChild(row);

        var record = { row: row, typeSelect: typeSelect, chainInput: chainInput, sequenceArea: sequenceArea, ligandInput: ligandInput, modificationsInput: modificationsInput, msaInput: msaInput, remove: remove };
        entityRows.push(record);

        function syncVisibility() {
          var isLigand = typeSelect.value === "ligand";
          sequenceArea.style.display = isLigand ? "none" : "";
          ligandInput.style.display = isLigand ? "" : "none";
          modificationsInput.style.display = isLigand ? "none" : "";
          msaInput.style.display = typeSelect.value === "rna" || typeSelect.value === "protein" ? "" : "none";
        }
        ["input", "change"].forEach(function (eventName) {
          typeSelect.addEventListener(eventName, refresh);
          chainInput.addEventListener(eventName, refresh);
          sequenceArea.addEventListener(eventName, refresh);
          ligandInput.addEventListener(eventName, refresh);
          modificationsInput.addEventListener(eventName, refresh);
          msaInput.addEventListener(eventName, refresh);
        });
        remove.addEventListener("click", function () {
          entityRows.splice(entityRows.indexOf(record), 1);
          record.row.remove();
          refresh();
        });
        syncVisibility();
        refresh();
      }

      function stringifyModifications(modifications) {
        return (modifications || []).map(function (modification) { return modification.position + ":" + modification.ccdCode; }).join(", ");
      }

      var addButton = element("button", "btn btn-soft", "Add entity"); addButton.type = "button";
      addButton.addEventListener("click", function () { addEntityRow(); });

      var error = element("p", "param-error"); error.hidden = true;
      var summary = element("p", "muted");

      target.appendChild(targetSelect);
      target.appendChild(labelled(nameInput, "Job name"));
      target.appendChild(labelled(seedsInput, "Model seeds"));
      target.appendChild(element("h4", "", "Molecular entities"));
      target.appendChild(entityList);
      target.appendChild(addButton);
      target.appendChild(element("h4", "", "Covalent bonds"));
      target.appendChild(labelled(bondsArea, "Bonded atom pairs"));
      target.appendChild(summary);
      target.appendChild(error);

      ["input", "change"].forEach(function (eventName) {
        targetSelect.addEventListener(eventName, refresh);
        nameInput.addEventListener(eventName, refresh);
        seedsInput.addEventListener(eventName, refresh);
        bondsArea.addEventListener(eventName, refresh);
      });

      function collectModel() {
        var entities = entityRows.map(function (record) {
          var type = record.typeSelect.value;
          var chainIds = record.chainInput.value.split(",").map(function (value) { return value.trim(); }).filter(Boolean);
          var modifications = parseModifications(record.modificationsInput.value, type);
          var entity = { type: type, chainIds: chainIds.length ? chainIds : (type === "ligand" ? "L" : "A") };

          if (type === "ligand") {
            var ligandText = record.ligandInput.value.trim();
            if (/^[A-Za-z0-9,]+$/.test(ligandText)) {
              entity.ligand = { source: "ccd", ccdCodes: ligandText.split(",").map(function (code) { return code.trim(); }).filter(Boolean) };
            } else {
              entity.ligand = { source: "smiles", smiles: ligandText };
            }
          } else {
            entity.sequence = record.sequenceArea.value;
            if (modifications.length) entity.modifications = modifications;
            var msaPath = record.msaInput.value.trim();
            if (msaPath) entity.msa = { unpaired: { source: "path", value: msaPath } };
          }
          return entity;
        });

        var model = {
          name: nameInput.value.trim() || "Untitled_Job",
          seeds: parseSeedsInput(seedsInput.value),
          entities: entities
        };
        var bonds = parseBonds(bondsArea.value);
        if (bonds.length) model.bonds = bonds;
        return model;
      }

      function materialize(result, targetValue) {
        if (!result || result.data == null) {
          context.setGeneratedFile(null);
          return;
        }
        var rendered = typeof result.data === "string" ? result.data + "\n" : JSON.stringify(result.data, null, 2) + "\n";
        context.setGeneratedFile(new File([rendered], "jaag-" + targetValue + ".json", { type: "application/json" }));
      }

      function refresh() {
        error.hidden = true; error.textContent = "";
        var targetValue = targetSelect.value;
        var model = collectModel();
        var result = core.build(model, targetValue);
        if (result.errors.length) {
          summary.textContent = "Invalid JAAG input";
          error.textContent = result.errors.join("; ");
          error.hidden = false;
          context.setGeneratedFile(null);
        } else {
          materialize(result, targetValue);
          summary.textContent = "JAAG " + targetValue + " document ready: " + model.entities.length + " entit" + (model.entities.length === 1 ? "y" : "ies") + ".";
        }
        context.changed();
      }

      // Seed one starter entity so the builder is non-empty on mount.
      addEntityRow({ type: "protein", chainIds: "A", sequence: "ACDEFGHIK" });

      targetSelect.value = targetName;
      refresh();

      return {
        refresh: refresh,
        readValue: function () {
          var targetValue = targetSelect.value;
          var model = collectModel();
          var result = core.build(model, targetValue);
          materialize(result, targetValue);
          return { schema: "jaag-superset", target: targetValue, model: model };
        },
        summarize: function () {
          var model = collectModel();
          if (!model.entities.length) return null;
          return { label: "Structure input", value: model.entities.length + " entit" + (model.entities.length === 1 ? "y" : "ies") + " · " + targetSelect.value };
        },
        validate: function () {
          if (!entityRows.length && !bondsArea.value.trim()) return [];
          var result = core.build(collectModel(), targetSelect.value);
          if (result.errors.length) {
            error.textContent = result.errors.join("; ");
            error.hidden = false;
            context.setGeneratedFile(null);
            return result.errors;
          }
          materialize(result, targetSelect.value);
          error.hidden = true; error.textContent = "";
          return [];
        },
        destroy: function () {
          // The plugin host clears the DOM; nothing asynchronous to cancel.
          context.setGeneratedFile(null);
        }
      };
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
