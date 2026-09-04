import { test, expect } from "@playwright/test";
import { store } from "../src/state/store.js";

test("custom region hierarchy inherits province and district ancestry", () => {
  store.loadPersisted({
    countries: [
      { id: "turkey", type: "country", name: "Turkey", provinces: [
        { id: "istanbul", type: "province", name: "Istanbul", districts: [
          { id: "sisli", type: "district", name: "Şişli" }
        ] }
      ] }
    ],
    custom: [
      { id: "esentepe", type: "neighborhood", name: "Esentepe", hierarchy: { parentId: "sisli", parentType: "district" } },
      { id: "zincirlikuyu", type: "cemetery", name: "Zincirlikuyu Mezarlığı", hierarchy: { parentId: "esentepe", parentType: "neighborhood" } }
    ]
  });

  const custom = store.get().regions.custom;
  expect(custom.find((region) => region.id === "esentepe")?.hierarchy).toMatchObject({
    countryId: "turkey",
    provinceId: "istanbul",
    districtId: "sisli"
  });
  expect(custom.find((region) => region.id === "zincirlikuyu")?.hierarchy).toMatchObject({
    countryId: "turkey",
    provinceId: "istanbul",
    districtId: "sisli"
  });
});
