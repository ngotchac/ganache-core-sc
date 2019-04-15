const BN = require("bn.js");
const assert = require("assert");
const bootstrap = require("./helpers/contract/bootstrap");

describe("Checkpointing / Reverting", function() {
  let context;
  let startingBalance;
  let snapshotId;

  before("Set up provider with web3 instance and deploy a contract", async function() {
    this.timeout(10000);
    const contractRef = {
      contractFiles: ["snapshot"],
      contractSubdirectory: "snapshotting"
    };

    context = await bootstrap(contractRef);
  });

  before("send a transaction then make a checkpoint", async function() {
    const { accounts, send, web3 } = context;

    await web3.eth.sendTransaction({
      from: accounts[0],
      to: accounts[1],
      value: web3.utils.toWei(new BN(1), "ether"),
      gas: 90000
    });

    // Since transactions happen immediately, we can assert the balance.
    let balance = await web3.eth.getBalance(accounts[0]);
    balance = parseFloat(web3.utils.fromWei(balance, "ether"));

    // Assert the starting balance is where we think it is, including tx costs.
    assert(balance > 98.9 && balance < 99);
    startingBalance = balance;

    // Now checkpoint.
    snapshotId = await send("evm_snapshot");
  });

  it("rolls back successfully", async() => {
    const { accounts, send, web3 } = context;

    // Send another transaction, check the balance, then roll it back to the old one and check the balance again.
    const { transactionHash } = await web3.eth.sendTransaction({
      from: accounts[0],
      to: accounts[1],
      value: web3.utils.toWei(new BN(1), "ether"),
      gas: 90000
    });

    let balance = await web3.eth.getBalance(accounts[0]);
    balance = parseFloat(web3.utils.fromWei(balance, "ether"));

    // Assert the starting balance is where we think it is, including tx costs.
    assert(balance > 97.9 && balance < 98);

    const status = await send("evm_revert", snapshotId.result);

    assert(status, "Snapshot should have returned true");

    let revertedBalance = await web3.eth.getBalance(accounts[0]);
    revertedBalance = parseFloat(web3.utils.fromWei(revertedBalance, "ether"));

    assert(revertedBalance === startingBalance, "Should have reverted back to the starting balance");

    const oldReceipt = await web3.eth.getTransactionReceipt(transactionHash);
    assert.strictEqual(oldReceipt, null, "Receipt should be null as it should have been removed");
  });

  it("checkpoints and reverts without persisting contract storage", async() => {
    const { accounts, instance, send } = context;

    const snapShotId = await send("evm_snapshot");
    let n1 = await instance.methods.n().call();
    assert.strictEqual(n1, "42", "Initial n is not 42");

    await instance.methods.inc().send({ from: accounts[0] });
    let n2 = await instance.methods.n().call();
    assert.strictEqual(n2, "43", "n is not 43 after first call to `inc`");

    await send("evm_revert", snapShotId.result);
    let n3 = await instance.methods.n().call();
    assert.strictEqual(n3, "42", "n is not 42 after reverting snapshot");

    // this is the real test. what happened was that the vm's contract storage
    // trie cache wasn't cleared when the vm's stateManager cache was cleared.
    await instance.methods.inc().send({ from: accounts[0] });
    let n4 = await instance.methods.n().call();
    assert.strictEqual(n4, "43", "n is not 43 after calling `inc` again");
  });
});
