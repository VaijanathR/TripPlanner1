import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { destinationsApi } from "../api/destinations";
import DestinationPicker from "./DestinationPicker";

vi.mock("../api/destinations", () => ({ destinationsApi: { search: vi.fn() } }));

const paris = [
  { geoname_id: 2988507, city: "Paris", state: "Île-de-France Region", country: "France", country_code: "FR" },
  { geoname_id: 4717560, city: "Paris", state: "Texas", country: "United States", country_code: "US" },
];

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const search = () => fireEvent.click(screen.getByRole("button", { name: "Find destination" }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DestinationPicker", () => {
  it("asks for country, state and city, and cannot search without a city", () => {
    render(<DestinationPicker onChoose={vi.fn()} />);

    expect(screen.getByLabelText("Country")).toBeInTheDocument();
    expect(screen.getByLabelText("State / region")).toBeInTheDocument();
    expect(screen.getByLabelText("City")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find destination" })).toBeDisabled();
    type("City", "P");
    expect(screen.getByRole("button", { name: "Find destination" })).toBeDisabled();
    type("City", "Pa");
    expect(screen.getByRole("button", { name: "Find destination" })).toBeEnabled();
  });

  it("does not search for a one-letter city even if the form is submitted directly (Enter)", () => {
    render(<DestinationPicker onChoose={vi.fn()} />);
    type("City", "P");

    fireEvent.submit(screen.getByLabelText("City").closest("form"));

    expect(destinationsApi.search).not.toHaveBeenCalled();
  });

  it("searches with what was typed, trimmed", async () => {
    destinationsApi.search.mockResolvedValue({ candidates: paris });
    render(<DestinationPicker onChoose={vi.fn()} />);

    type("Country", "United States");
    type("State / region", "Texas");
    type("City", "  Paris ");
    search();

    await screen.findByRole("list", { name: "Matching places" });
    expect(destinationsApi.search).toHaveBeenCalledWith({ city: "Paris", state: "Texas", country: "United States" });
  });

  it("lists every match so the user can tell the Parises apart", async () => {
    destinationsApi.search.mockResolvedValue({ candidates: paris });
    render(<DestinationPicker onChoose={vi.fn()} />);
    type("City", "Paris");
    search();

    expect(await screen.findByRole("button", { name: "Paris, Île-de-France Region, France" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paris, Texas, United States" })).toBeInTheDocument();
  });

  it("saves the chosen place by id", async () => {
    destinationsApi.search.mockResolvedValue({ candidates: paris });
    const onChoose = vi.fn().mockResolvedValue();
    render(<DestinationPicker onChoose={onChoose} />);
    type("City", "Paris");
    search();

    fireEvent.click(await screen.findByRole("button", { name: "Paris, Texas, United States" }));

    await waitFor(() => expect(onChoose).toHaveBeenCalledWith(4717560));
  });

  it("shows Saving… and locks the other choices while a choice is being saved", async () => {
    destinationsApi.search.mockResolvedValue({ candidates: paris });
    render(<DestinationPicker onChoose={() => new Promise(() => {})} />);
    type("City", "Paris");
    search();

    fireEvent.click(await screen.findByRole("button", { name: /Paris, Texas/ }));

    expect(await screen.findByText("Saving…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Île-de-France/ })).toBeDisabled();
  });

  it("shows why saving failed and lets the user pick again", async () => {
    destinationsApi.search.mockResolvedValue({ candidates: paris });
    const onChoose = vi.fn().mockRejectedValue(new Error("Place lookup is temporarily unavailable"));
    render(<DestinationPicker onChoose={onChoose} />);
    type("City", "Paris");
    search();

    fireEvent.click(await screen.findByRole("button", { name: /Paris, Texas/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Place lookup is temporarily unavailable");
    expect(screen.getByRole("button", { name: /Paris, Texas/ })).toBeEnabled();
  });

  it("says so when nothing matches, rather than showing an empty list", async () => {
    destinationsApi.search.mockResolvedValue({ candidates: [] });
    render(<DestinationPicker onChoose={vi.fn()} />);
    type("City", "Atlantis");
    search();

    expect(await screen.findByText(/No places match/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Matching places" })).not.toBeInTheDocument();
  });

  it("offers the same-named places elsewhere when nothing matches the country, instead of a dead end", async () => {
    destinationsApi.search.mockResolvedValue({ candidates: [], alternatives: paris });
    const onChoose = vi.fn().mockResolvedValue();
    render(<DestinationPicker onChoose={onChoose} />);
    type("Country", "Japan");
    type("City", "Paris");
    search();

    expect(await screen.findByText(/No place called “Paris” matches that country or region/)).toBeInTheDocument();
    expect(screen.queryByText(/No places match\./)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Matching places" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Paris, Texas, United States" })); // inside "Places with that name elsewhere"
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith(4717560));
    expect(screen.getByRole("list", { name: "Places with that name elsewhere" })).toBeInTheDocument();
  });

  it("does not show alternatives when there are real matches", async () => {
    destinationsApi.search.mockResolvedValue({ candidates: [paris[0]], alternatives: [paris[1]] });
    render(<DestinationPicker onChoose={vi.fn()} />);
    type("City", "Paris");
    search();

    await screen.findByRole("list", { name: "Matching places" });
    expect(screen.queryByRole("list", { name: "Places with that name elsewhere" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Texas/ })).not.toBeInTheDocument();
  });

  it("tolerates an older server that sends no alternatives", async () => {
    destinationsApi.search.mockResolvedValue({ candidates: [] });
    render(<DestinationPicker onChoose={vi.fn()} />);
    type("City", "Atlantis");
    search();

    expect(await screen.findByText(/No places match\./)).toBeInTheDocument();
  });

  it("shows an error when the search itself fails, and the form still works", async () => {
    destinationsApi.search.mockRejectedValueOnce(new Error("Place search is temporarily unavailable"));
    render(<DestinationPicker onChoose={vi.fn()} />);
    type("City", "Paris");
    search();

    expect(await screen.findByRole("alert")).toHaveTextContent("Place search is temporarily unavailable");

    destinationsApi.search.mockResolvedValueOnce({ candidates: paris });
    search();
    expect(await screen.findByRole("list", { name: "Matching places" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("only offers Cancel when there is something to cancel back to", () => {
    const { rerender } = render(<DestinationPicker onChoose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    const onCancel = vi.fn();
    rerender(<DestinationPicker onChoose={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clears the previous results when searching again", async () => {
    destinationsApi.search.mockResolvedValueOnce({ candidates: paris });
    render(<DestinationPicker onChoose={vi.fn()} />);
    type("City", "Paris");
    search();
    await screen.findByRole("list", { name: "Matching places" });

    destinationsApi.search.mockReturnValueOnce(new Promise(() => {}));
    search();

    await waitFor(() => expect(screen.queryByRole("list", { name: "Matching places" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Searching…" })).toBeDisabled();
  });
});
